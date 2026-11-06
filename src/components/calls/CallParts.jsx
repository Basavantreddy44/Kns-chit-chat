import { useEffect, useRef, useState } from 'react';
import {
  BellOff,
  Maximize,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
} from 'lucide-react';
import { EmployeeAvatar } from '../workspace/EmployeeParts';
import { useCall } from '../../context/CallContext';
import './calls.css';

const STATUS_LABELS = {
  calling: 'Calling…',
  ringing: 'Ringing…',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Connection lost. Reconnecting…',
};

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function CallDuration({ since }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className="call-panel__duration">{formatDuration(Math.max(0, Math.floor((now - since) / 1000)))}</span>;
}

/** Sound always comes from the separate audio element, so every video here is muted. */
function VideoTrack({ track, className, label }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !track) return undefined;
    video.srcObject = new MediaStream([track]);
    video.play?.().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [track]);

  return <video ref={videoRef} className={className} autoPlay playsInline muted aria-label={label} />;
}

/** Call and screen-share buttons in a one-to-one chat's header. */
export function CallButtons({ employee, disabled }) {
  const { start, isBusy, isLive, incoming, employee: inCallWith, isSharing, canShareScreen, startSharing, stopSharing } = useCall();
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  const call = async (type) => {
    setError('');
    setIsStarting(true);
    try {
      await start(employee, type);
    } catch (startError) {
      setError(startError?.message || 'The call couldn’t be started.');
    } finally {
      setIsStarting(false);
    }
  };

  const cannotCall = disabled || isBusy || isStarting || Boolean(incoming);
  const callTitle = (name) => (disabled ? 'You can only call your connections' : name);
  const isInThisCall = isLive && inCallWith?.id === employee.id;

  let shareTitle = 'Share your screen';
  if (!canShareScreen) shareTitle = 'Screen sharing isn’t supported in this browser';
  else if (!isInThisCall) shareTitle = 'Start a call to share your screen';
  else if (isSharing) shareTitle = 'Stop sharing your screen';

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={`Audio call with ${employee.full_name}`}
        title={callTitle('Audio call')}
        disabled={cannotCall}
        onClick={() => call('audio')}
      >
        <Phone size={20} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Video call with ${employee.full_name}`}
        title={callTitle('Video call')}
        disabled={cannotCall}
        onClick={() => call('video')}
      >
        <Video size={20} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`icon-button${isInThisCall && isSharing ? ' is-sharing' : ''}`}
        aria-label={isSharing && isInThisCall ? 'Stop sharing your screen' : 'Share screen'}
        title={shareTitle}
        disabled={!isInThisCall || !canShareScreen}
        onClick={isSharing ? stopSharing : startSharing}
      >
        {isInThisCall && isSharing ? <ScreenShareOff size={20} aria-hidden="true" /> : <ScreenShare size={20} aria-hidden="true" />}
      </button>
      {error && (
        <p className="call-button__error" role="alert">
          {error}
          <button type="button" className="link-button" onClick={() => setError('')}>
            Dismiss
          </button>
        </p>
      )}
    </>
  );
}

function IncomingCall() {
  const { incoming, accept, reject, ignore } = useCall();
  const acceptRef = useRef(null);
  const callId = incoming?.call.id;

  useEffect(() => {
    if (callId) acceptRef.current?.focus();
  }, [callId]);

  if (!incoming) return null;
  const { employee, call, error, isAnswering } = incoming;

  return (
    <div className="incoming-call" role="alertdialog" aria-labelledby="incoming-call-title" aria-describedby="incoming-call-type">
      <div className="incoming-call__person">
        <span className="incoming-call__avatar">
          <EmployeeAvatar employee={employee} size={56} />
        </span>
        <div className="row__body">
          <p id="incoming-call-title" className="incoming-call__name">
            {employee.full_name}
          </p>
          <p id="incoming-call-type" className="row__meta">
            Incoming {call.call_type} call
          </p>
        </div>
      </div>
      {error && (
        <p className="incoming-call__error" role="alert">
          {error}
        </p>
      )}
      <div className="incoming-call__actions">
        <button ref={acceptRef} type="button" className="call-action call-action--accept" onClick={accept} disabled={isAnswering}>
          {call.call_type === 'video' ? <Video size={18} aria-hidden="true" /> : <Phone size={18} aria-hidden="true" />}{' '}
          {isAnswering ? 'Answering…' : 'Accept'}
        </button>
        <button type="button" className="call-action call-action--reject" onClick={reject} disabled={isAnswering}>
          <PhoneOff size={18} aria-hidden="true" /> Reject
        </button>
        <button type="button" className="call-action" onClick={ignore} disabled={isAnswering}>
          <BellOff size={18} aria-hidden="true" /> Ignore
        </button>
      </div>
    </div>
  );
}

function CallControls() {
  const { phase, isLive, isMuted, isCameraOn, isSharing, canShareScreen, toggleMute, toggleCamera, startSharing, stopSharing, end } = useCall();

  let shareTitle = isSharing ? 'Stop sharing your screen' : 'Share your screen';
  if (!canShareScreen) shareTitle = 'Screen sharing isn’t supported in this browser';
  else if (!isLive) shareTitle = 'You can share your screen once the call connects';

  return (
    <div className="call-controls">
      <button
        type="button"
        className={`call-control${isMuted ? ' is-on' : ''}`}
        aria-pressed={isMuted}
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        title={isMuted ? 'Unmute' : 'Mute'}
        onClick={toggleMute}
      >
        {isMuted ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className={`call-control${isCameraOn ? '' : ' is-on'}`}
        aria-pressed={isCameraOn}
        aria-label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
        title={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
        onClick={toggleCamera}
      >
        {isCameraOn ? <Video size={20} aria-hidden="true" /> : <VideoOff size={20} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className={`call-control${isSharing ? ' is-sharing' : ''}`}
        aria-pressed={isSharing}
        aria-label={isSharing ? 'Stop sharing your screen' : 'Share screen'}
        title={shareTitle}
        disabled={!isLive || !canShareScreen}
        onClick={isSharing ? stopSharing : startSharing}
      >
        {isSharing ? <ScreenShareOff size={20} aria-hidden="true" /> : <ScreenShare size={20} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="call-control call-control--end"
        aria-label={isLive || phase === 'connecting' ? 'End call' : 'Cancel call'}
        title={isLive || phase === 'connecting' ? 'End call' : 'Cancel call'}
        onClick={end}
      >
        <PhoneOff size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

function CallStatus() {
  const { phase, isLive, connectedAt } = useCall();
  return (
    <p className="call-panel__status" role="status">
      {STATUS_LABELS[phase]}
      {isLive && connectedAt && (
        <>
          {' · '}
          <CallDuration since={connectedAt} />
        </>
      )}
    </p>
  );
}

/** The large view, for video and shared screens. */
function CallStage() {
  const {
    employee,
    isLive,
    isCameraOn,
    isSharing,
    isMuted,
    localCamera,
    remoteCamera,
    remoteScreen,
    remoteCameraOn,
    remoteSharing,
    remoteMuted,
    mediaNotice,
    stopSharing,
    setMinimized,
  } = useCall();
  const mainRef = useRef(null);

  const showRemoteScreen = isLive && remoteSharing && remoteScreen;
  const showRemoteCamera = isLive && remoteCameraOn && remoteCamera;

  return (
    <section className="call-stage" aria-label={`Call with ${employee.full_name}`}>
      <header className="call-stage__header">
        <EmployeeAvatar employee={employee} size={36} />
        <div className="row__body">
          <p className="call-panel__name">{employee.full_name}</p>
          <CallStatus />
        </div>
        {showRemoteScreen && (
          <button
            type="button"
            className="icon-button"
            aria-label="Show the shared screen full screen"
            title="Full screen"
            onClick={() => mainRef.current?.requestFullscreen?.()}
          >
            <Maximize size={20} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Minimise call"
          title="Minimise, to keep chatting"
          onClick={() => setMinimized(true)}
        >
          <Minimize2 size={20} aria-hidden="true" />
        </button>
      </header>

      <div className="call-stage__main" ref={mainRef}>
        {showRemoteScreen ? (
          <VideoTrack track={remoteScreen} className="call-video call-video--screen" label={`${employee.full_name}’s shared screen`} />
        ) : showRemoteCamera ? (
          <VideoTrack track={remoteCamera} className="call-video" label={`${employee.full_name}’s camera`} />
        ) : (
          <div className="call-stage__placeholder">
            <EmployeeAvatar employee={employee} size={96} />
            <p>{employee.full_name}</p>
            {isLive && <p className="row__meta">Camera is off</p>}
          </div>
        )}

        {showRemoteScreen && <span className="call-stage__tag">{employee.full_name} is sharing their screen</span>}

        <div className="call-stage__tiles">
          {showRemoteScreen && showRemoteCamera && (
            <div className="call-tile">
              <VideoTrack track={remoteCamera} className="call-video" label={`${employee.full_name}’s camera`} />
            </div>
          )}
          {isCameraOn && localCamera && (
            <div className="call-tile">
              <VideoTrack track={localCamera} className="call-video call-video--mirror" label="Your camera" />
              <span className="call-tile__label">You{isMuted ? ' (muted)' : ''}</span>
            </div>
          )}
        </div>

        {remoteMuted && isLive && <span className="call-stage__muted">{employee.full_name} is muted</span>}
      </div>

      {isSharing && (
        <p className="call-stage__sharing" role="status">
          <ScreenShare size={16} aria-hidden="true" /> You are sharing your screen.
          <button type="button" className="link-button" onClick={stopSharing}>
            Stop sharing
          </button>
        </p>
      )}
      {mediaNotice && (
        <p className="call-stage__notice" role="alert">
          {mediaNotice}
        </p>
      )}

      <CallControls />
    </section>
  );
}

/** The small card: for audio calls, and any call that's been minimised. */
function CallCard({ hasStage }) {
  const { employee, isLive, isSharing, remoteMuted, mediaNotice, setMinimized } = useCall();

  return (
    <section className="call-panel" aria-label={`Call with ${employee.full_name}`}>
      <div className="call-panel__person">
        <EmployeeAvatar employee={employee} size={44} />
        <div className="row__body">
          <p className="call-panel__name">{employee.full_name}</p>
          <CallStatus />
          {remoteMuted && isLive && <p className="row__meta">{employee.full_name} is muted</p>}
          {isSharing && <p className="call-panel__sharing">You are sharing your screen</p>}
        </div>
        {hasStage && (
          <button type="button" className="icon-button" aria-label="Expand call" title="Expand" onClick={() => setMinimized(false)}>
            <Maximize2 size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {mediaNotice && (
        <p className="incoming-call__error" role="alert">
          {mediaNotice}
        </p>
      )}
      <CallControls />
    </section>
  );
}

/** Always mounted in the workspace, so a call survives moving between pages. */
export function CallLayer() {
  const { remoteAudioRef, phase, notice, employee, callType, isCameraOn, isSharing, remoteCameraOn, remoteSharing, isMinimized } = useCall();

  const isActive = phase !== 'idle' && phase !== 'ended' && employee;
  const hasStage = callType === 'video' || isCameraOn || isSharing || remoteCameraOn || remoteSharing;

  return (
    <>
      {/* Not hidden with CSS: some browsers stop playing audio from hidden elements. */}
      <audio ref={remoteAudioRef} autoPlay playsInline />
      {isActive && hasStage && !isMinimized && <CallStage />}
      <div className="call-layer">
        <IncomingCall />
        {isActive && (!hasStage || isMinimized) && <CallCard hasStage={hasStage} />}
        {phase === 'ended' && (
          <div className="call-panel call-panel--ended" role="status">
            <PhoneOff size={18} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
      </div>
    </>
  );
}
