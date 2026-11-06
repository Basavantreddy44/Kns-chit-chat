import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, LogOut, Pencil, UserPlus, X } from 'lucide-react';
import { ChannelFields, ChannelIcon, ChannelTags, EmployeePicker, memberCountLabel, MemberRow } from './ChannelParts';
import Alert from '../common/Alert';
import Button from '../common/Button';
import { SharedFilesSection } from '../files/FileParts';
import { ConfirmDialog, ListSkeleton, Modal } from '../workspace/PageParts';
import { usePagedList } from '../../hooks/usePagedList';
import {
  inviteMembers,
  leaveChannel,
  listChannelMembers,
  MEMBER_PAGE_SIZE,
  removeMember,
  setChannelArchived,
  setMemberRole,
  updateChannel,
} from '../../services/channelService';

function EditDialog({ channel, onClose, onSaved }) {
  const [values, setValues] = useState({
    name: channel.name,
    description: channel.description ?? '',
    category: channel.category ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await updateChannel(channel.id, values);
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError?.message || 'Something went wrong. Please try again.');
      setIsSaving(false);
    }
  };

  return (
    <Modal title="Edit channel" onCancel={onClose}>
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <Alert variant="error">{error}</Alert>}
        <ChannelFields values={values} onChange={setValues} disabled={isSaving} />
        <div className="dialog__actions">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving} loadingText="Saving…">
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InviteDialog({ channel, userId, onClose, onInvited }) {
  const [selected, setSelected] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSending(true);
    setError('');
    try {
      const count = await inviteMembers(
        channel.id,
        selected.map((employee) => employee.id),
      );
      await onInvited(count, selected.length);
      onClose();
    } catch (inviteError) {
      setError(inviteError?.message || 'Something went wrong. Please try again.');
      setIsSending(false);
    }
  };

  return (
    <Modal title={`Invite to ${channel.name}`} onCancel={onClose}>
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <Alert variant="error">{error}</Alert>}
        <EmployeePicker selected={selected} onChange={setSelected} disabled={isSending} excludeId={userId} />
        <div className="dialog__actions">
          <Button variant="outline" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!selected.length} isLoading={isSending} loadingText="Inviting…">
            Send invitations
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The channel's details, members and everything its owner and admins can manage. */
export default function ChannelDetails({ channel, userId, onClose, onChanged }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(null); // edit | invite | { type, member? }
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState({ variant: '', message: '' });

  const fetchMembers = useCallback((page) => listChannelMembers(channel.id, page), [channel.id]);
  const members = usePagedList(fetchMembers, channel.id, MEMBER_PAGE_SIZE);

  const isOwner = channel.my_role === 'owner';
  const isManager = isOwner || channel.my_role === 'admin';
  const isArchived = Boolean(channel.archived_at);

  const showError = (error) => setNotice({ variant: 'error', message: error?.message || 'Something went wrong.' });

  const runConfirmed = async (action) => {
    setIsBusy(true);
    setNotice({ variant: '', message: '' });
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      setIsBusy(false);
      setDialog(null);
    }
  };

  const changeRole = async (member, role) => {
    setNotice({ variant: '', message: '' });
    try {
      await setMemberRole(channel.id, member.id, role);
      await Promise.all([members.refresh(), onChanged()]);
    } catch (error) {
      showError(error);
    }
  };

  const canRemove = (member) => {
    if (member.id === userId || member.role === 'owner' || isArchived) return false;
    return isOwner || (channel.my_role === 'admin' && member.role !== 'admin');
  };

  return (
    <aside className="thread-info" aria-label="Channel details">
      <header className="thread-info__header">
        <h2>Details</h2>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="thread-info__person">
        <ChannelIcon channel={channel} size={64} />
        <p className="profile-head__name">{channel.name}</p>
        <p className="row__meta">{memberCountLabel(channel.member_count)}</p>
        <div className="channel-tags">
          <ChannelTags channel={channel} />
        </div>
      </div>

      {notice.message && (
        <Alert variant={notice.variant} onDismiss={() => setNotice({ variant: '', message: '' })}>
          {notice.message}
        </Alert>
      )}

      <dl className="detail-list">
        <dt>Owner</dt>
        <dd>{channel.owner_name || 'Not set'}</dd>
      </dl>
      {channel.description && <p className="channel-description">{channel.description}</p>}

      <div className="channel-actions">
        {isManager && !isArchived && (
          <>
            <Button variant="outline" onClick={() => setDialog('invite')} leftIcon={<UserPlus size={16} aria-hidden="true" />}>
              Invite
            </Button>
            <Button variant="outline" onClick={() => setDialog('edit')} leftIcon={<Pencil size={16} aria-hidden="true" />}>
              Edit
            </Button>
          </>
        )}
        {isOwner && (
          <Button
            variant="outline"
            onClick={() => setDialog({ type: 'archive' })}
            leftIcon={
              isArchived ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />
            }
          >
            {isArchived ? 'Restore' : 'Archive'}
          </Button>
        )}
        {!isOwner && (
          <Button variant="ghost" onClick={() => setDialog({ type: 'leave' })} leftIcon={<LogOut size={16} aria-hidden="true" />}>
            Leave
          </Button>
        )}
      </div>

      <section aria-label="Channel members">
        <h3 className="channel-members__title">Members</h3>
        {members.status === 'loading' && <ListSkeleton rows={3} />}
        {members.status === 'error' && <Alert variant="error">{members.error}</Alert>}
        <ul className="channel-members">
          {members.items.map((member) => {
            const isActive = member.membership_status === 'active';
            return (
              <MemberRow
                key={member.id}
                member={member}
                userId={userId}
                subject="the channel"
                canChangeRole={isOwner && isActive && member.id !== userId && !isArchived}
                canRemove={canRemove(member)}
                removeLabel={isActive ? 'Remove' : 'Withdraw invitation'}
                onToggleAdmin={() => changeRole(member, member.role === 'admin' ? 'member' : 'admin')}
                onMakeOwner={() => setDialog({ type: 'owner', member })}
                onRemove={() => setDialog({ type: 'remove', member })}
              />
            );
          })}
        </ul>
        {members.hasMore && (
          <div className="page__more">
            <Button variant="ghost" onClick={members.loadMore} isLoading={members.status === 'loadingMore'} loadingText="Loading…">
              Show more members
            </Button>
          </div>
        )}
      </section>

      <SharedFilesSection channelId={channel.id} />

      {dialog === 'edit' && <EditDialog channel={channel} onClose={() => setDialog(null)} onSaved={onChanged} />}

      {dialog === 'invite' && (
        <InviteDialog
          channel={channel}
          userId={userId}
          onClose={() => setDialog(null)}
          onInvited={async (count, requested) => {
            await members.refresh();
            const skipped = requested - count;
            setNotice({
              variant: 'success',
              message: `${count} ${count === 1 ? 'invitation' : 'invitations'} sent.${
                skipped ? ` ${skipped} already in the channel.` : ''
              }`,
            });
          }}
        />
      )}

      {dialog?.type === 'remove' && (
        <ConfirmDialog
          title={dialog.member.membership_status === 'active' ? 'Remove member?' : 'Withdraw invitation?'}
          confirmLabel={dialog.member.membership_status === 'active' ? 'Remove member' : 'Withdraw invitation'}
          isBusy={isBusy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            runConfirmed(async () => {
              await removeMember(channel.id, dialog.member.id);
              await Promise.all([members.refresh(), onChanged()]);
            })
          }
        >
          {dialog.member.membership_status === 'active'
            ? `${dialog.member.full_name} will lose access to this channel and its messages.`
            : `${dialog.member.full_name} will no longer be able to join through this invitation.`}
        </ConfirmDialog>
      )}

      {dialog?.type === 'owner' && (
        <ConfirmDialog
          title="Transfer ownership?"
          confirmLabel="Make owner"
          isBusy={isBusy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            runConfirmed(async () => {
              await setMemberRole(channel.id, dialog.member.id, 'owner');
              await Promise.all([members.refresh(), onChanged()]);
            })
          }
        >
          {dialog.member.full_name} will own this channel, and you will become an admin. Only they can undo this.
        </ConfirmDialog>
      )}

      {dialog?.type === 'archive' && (
        <ConfirmDialog
          title={isArchived ? 'Restore channel?' : 'Archive channel?'}
          confirmLabel={isArchived ? 'Restore channel' : 'Archive channel'}
          isBusy={isBusy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            runConfirmed(async () => {
              await setChannelArchived(channel.id, !isArchived);
              await onChanged();
            })
          }
        >
          {isArchived
            ? 'Members will be able to post again, and public channels will return to All Channels.'
            : 'Members can still read its history, but nobody can post or join. You can restore it later.'}
        </ConfirmDialog>
      )}

      {dialog?.type === 'leave' && (
        <ConfirmDialog
          title="Leave channel?"
          confirmLabel="Leave channel"
          isBusy={isBusy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            runConfirmed(async () => {
              await leaveChannel(channel.id);
              await onChanged({ left: true });
              navigate('/channels/mine');
            })
          }
        >
          {channel.channel_type === 'private'
            ? 'You will lose access to its messages, and you would need a new invitation to return.'
            : 'You will stop receiving its messages. You can join again at any time.'}
        </ConfirmDialog>
      )}
    </aside>
  );
}
