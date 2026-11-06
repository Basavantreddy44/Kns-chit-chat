import { getSupabase } from './supabaseClient';

const HELLO_INTERVAL_MS = 1000;
const OFFER_RESEND_MS = 4000;
const ICE_RESTART_AFTER_MS = 5000;
const GIVE_UP_AFTER_MS = 30000;

// Fixed order, agreed by both sides through the caller's offer.
const SLOTS = ['audio', 'camera', 'screen'];
const SLOT_KINDS = { audio: 'audio', camera: 'video', screen: 'video' };

/**
 * The live connection for one call: a WebRTC peer connection, plus a private Realtime
 * channel used only to set it up. Media goes directly between browsers.
 *
 * The connection reserves one slot each for audio, camera and screen from the start.
 * Turning the camera or a screen share on or off only swaps what's in the slot, so it's
 * immediate and can't disturb the call. An empty slot sends nothing.
 *
 * Realtime broadcasts aren't stored, so a message sent before the other side has
 * joined is simply lost. Each side therefore repeats "hello" until it hears back, and
 * only then does the caller send its offer.
 */
export class CallPeer {
  constructor({ callId, isCaller, iceServers, localTracks, onRemoteTracks, onStatus, onRemoteMedia, onLost }) {
    this.callId = callId;
    this.isCaller = isCaller;
    this.localTracks = { ...localTracks };
    this.onRemoteTracks = onRemoteTracks;
    this.onStatus = onStatus;
    this.onRemoteMedia = onRemoteMedia;
    this.onLost = onLost;

    this.isClosed = false;
    this.peerIsReady = false;
    this.isMakingOffer = false;
    this.isIgnoringOffer = false;
    this.pendingCandidates = [];
    this.hasConnected = false;
    this.timers = new Map();

    this.pc = new RTCPeerConnection({ iceServers });

    // The caller's offer sets the slot order. The callee's slots come from that offer.
    if (isCaller) {
      SLOTS.forEach((slot) => this.pc.addTransceiver(SLOT_KINDS[slot], { direction: 'sendrecv' }));
      this.syncSlots();
    }

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'candidate', candidate: candidate.toJSON() });
    };
    this.pc.onnegotiationneeded = () => this.negotiate();
    this.pc.onconnectionstatechange = () => this.handleConnectionState();

    this.channel = getSupabase().channel(`call:${callId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    this.channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        this.handleSignal(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.startHello();
      });

    // A call that can't get connected at all has to end eventually.
    this.setTimer('giveUp', () => this.lose(), GIVE_UP_AFTER_MS);
  }

  /** Puts each local track in its slot, and reports what the other side's slots hold. */
  syncSlots() {
    const transceivers = this.pc.getTransceivers();
    if (transceivers.length < SLOTS.length) return;

    SLOTS.forEach((slot, index) => {
      const transceiver = transceivers[index];
      transceiver.direction = 'sendrecv';
      transceiver.sender.replaceTrack(this.localTracks[slot] ?? null).catch(() => {});
    });

    this.onRemoteTracks({
      audio: transceivers[0].receiver.track,
      camera: transceivers[1].receiver.track,
      screen: transceivers[2].receiver.track,
    });
  }

  /** Swaps what's being sent in a slot. Null stops sending it. */
  setTrack(slot, track) {
    this.localTracks[slot] = track ?? null;
    const transceiver = this.pc.getTransceivers()[SLOTS.indexOf(slot)];
    if (transceiver) return transceiver.sender.replaceTrack(track ?? null);
    return Promise.resolve();
  }

  setTimer(name, callback, delay) {
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(callback, delay));
  }

  clearTimer(name) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
  }

  send(message) {
    if (this.isClosed) return;
    this.channel.send({ type: 'broadcast', event: 'signal', payload: message }).catch(() => {});
  }

  startHello() {
    const sayHello = () => {
      if (this.isClosed || this.peerIsReady) return;
      this.send({ type: 'hello' });
      this.setTimer('hello', sayHello, HELLO_INTERVAL_MS);
    };
    sayHello();
  }

  async negotiate() {
    // The caller opens the conversation. After that, either side can renegotiate.
    if (this.isClosed || !this.peerIsReady) return;
    if (!this.isCaller && !this.pc.remoteDescription) return;

    try {
      this.isMakingOffer = true;
      await this.pc.setLocalDescription();
      this.send({ type: 'description', description: this.pc.localDescription });
      this.scheduleOfferResend();
    } catch {
      // The connection may have closed meanwhile. A restart covers anything else.
    } finally {
      this.isMakingOffer = false;
    }
  }

  // A lost offer would otherwise leave both sides waiting forever.
  scheduleOfferResend() {
    this.setTimer(
      'offerResend',
      () => {
        if (this.isClosed || this.pc.signalingState !== 'have-local-offer') return;
        this.send({ type: 'description', description: this.pc.localDescription });
        this.scheduleOfferResend();
      },
      OFFER_RESEND_MS,
    );
  }

  async handleSignal(message) {
    if (this.isClosed || !message) return;

    try {
      if (message.type === 'hello' || message.type === 'hello-back') {
        if (message.type === 'hello') this.send({ type: 'hello-back' });
        if (!this.peerIsReady) {
          this.peerIsReady = true;
          this.clearTimer('hello');
          if (this.isCaller) await this.negotiate();
        }
        return;
      }

      if (message.type === 'media') {
        this.onRemoteMedia(message);
        return;
      }

      if (message.type === 'description') {
        await this.handleDescription(message.description);
        return;
      }

      if (message.type === 'candidate') {
        if (this.pc.remoteDescription) await this.addCandidate(message.candidate);
        else this.pendingCandidates.push(message.candidate);
      }
    } catch {
      // A single bad message shouldn't end the call. The connection watch handles failure.
    }
  }

  async handleDescription(description) {
    // The other side repeated an offer we already answered, so our answer was lost.
    if (
      description.type === 'offer' &&
      this.pc.signalingState === 'stable' &&
      this.pc.remoteDescription?.sdp === description.sdp
    ) {
      this.send({ type: 'description', description: this.pc.localDescription });
      return;
    }

    // Both sent offers at once: the callee gives way, the caller ignores theirs.
    const isCollision =
      description.type === 'offer' && (this.isMakingOffer || this.pc.signalingState !== 'stable');
    this.isIgnoringOffer = this.isCaller && isCollision;
    if (this.isIgnoringOffer) return;

    // An answer repeated after we've already applied it.
    if (description.type === 'answer' && this.pc.signalingState === 'stable') return;

    await this.pc.setRemoteDescription(description);
    this.clearTimer('offerResend');

    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    await Promise.all(queued.map((candidate) => this.addCandidate(candidate)));

    if (description.type === 'offer') {
      if (!this.isCaller) this.syncSlots();
      await this.pc.setLocalDescription();
      this.send({ type: 'description', description: this.pc.localDescription });
    }
  }

  async addCandidate(candidate) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      if (!this.isIgnoringOffer) throw error;
    }
  }

  handleConnectionState() {
    if (this.isClosed) return;
    const state = this.pc.connectionState;

    if (state === 'connected') {
      this.hasConnected = true;
      this.clearTimer('giveUp');
      this.clearTimer('iceRestart');
      this.onStatus('connected');
      return;
    }

    if (state !== 'disconnected' && state !== 'failed') return;

    // Often brief, such as when switching networks. Try to recover before giving up.
    if (this.hasConnected) this.onStatus('reconnecting');
    if (!this.timers.has('giveUp')) this.setTimer('giveUp', () => this.lose(), GIVE_UP_AFTER_MS);

    if (state === 'failed') this.restartIce();
    else this.setTimer('iceRestart', () => this.restartIce(), ICE_RESTART_AFTER_MS);
  }

  restartIce() {
    if (!this.isClosed && this.isCaller) this.pc.restartIce();
  }

  lose() {
    if (!this.isClosed) this.onLost(this.hasConnected);
  }

  sendMediaState(state) {
    this.send({ type: 'media', ...state });
  }

  close() {
    if (this.isClosed) return;
    this.isClosed = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
    getSupabase().removeChannel(this.channel);
  }
}
