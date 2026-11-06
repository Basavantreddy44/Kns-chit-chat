import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Pencil, UserPlus, X } from 'lucide-react';
import { GroupIcon } from './GroupThread';
import { EmployeePicker, memberCountLabel, MemberRow } from '../channels/ChannelParts';
import Alert from '../common/Alert';
import Button from '../common/Button';
import { SharedFilesSection } from '../files/FileParts';
import { ConfirmDialog, ListSkeleton, Modal } from '../workspace/PageParts';
import { usePagedList } from '../../hooks/usePagedList';
import {
  addGroupMembers,
  GROUP_MEMBER_PAGE_SIZE,
  leaveGroup,
  listGroupMembers,
  removeGroupMember,
  setGroupMemberRole,
  updateGroup,
} from '../../services/groupService';
import { purgePendingFiles } from '../../services/fileService';

/** Name and description: shared by creating and editing a group. */
export function GroupFields({ values, onChange, disabled, nameError }) {
  const set = (field) => (event) => onChange({ ...values, [field]: event.target.value });

  return (
    <>
      <label className="select-field">
        Group name
        <input
          className="select"
          id="group-name"
          maxLength={60}
          placeholder="e.g. Release planning"
          value={values.name}
          onChange={set('name')}
          disabled={disabled}
          aria-invalid={Boolean(nameError)}
          required
        />
        {nameError && (
          <span className="field__error" role="alert">
            {nameError}
          </span>
        )}
      </label>
      <label className="select-field">
        Description (optional)
        <textarea
          className="select channel-textarea"
          id="group-description"
          maxLength={500}
          rows={3}
          placeholder="What is this group for?"
          value={values.description}
          onChange={set('description')}
          disabled={disabled}
        />
      </label>
    </>
  );
}

function EditDialog({ group, onClose, onSaved }) {
  const [values, setValues] = useState({ name: group.name, description: group.description ?? '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await updateGroup(group.id, values);
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError?.message || 'Something went wrong. Please try again.');
      setIsSaving(false);
    }
  };

  return (
    <Modal title="Edit group" onCancel={onClose}>
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <Alert variant="error">{error}</Alert>}
        <GroupFields values={values} onChange={setValues} disabled={isSaving} />
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

function AddDialog({ group, userId, onClose, onAdded }) {
  const [selected, setSelected] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsAdding(true);
    setError('');
    try {
      const count = await addGroupMembers(
        group.id,
        selected.map((employee) => employee.id),
      );
      await onAdded(count, selected.length);
      onClose();
    } catch (addError) {
      setError(addError?.message || 'Something went wrong. Please try again.');
      setIsAdding(false);
    }
  };

  return (
    <Modal title={`Add to ${group.name}`} onCancel={onClose}>
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <Alert variant="error">{error}</Alert>}
        <EmployeePicker
          selected={selected}
          onChange={setSelected}
          disabled={isAdding}
          excludeId={userId}
          connectedOnly
          label="Add your connections"
        />
        <p className="row__meta">New members can read the group’s earlier messages.</p>
        <div className="dialog__actions">
          <Button variant="outline" onClick={onClose} disabled={isAdding}>
            Cancel
          </Button>
          <Button type="submit" disabled={!selected.length} isLoading={isAdding} loadingText="Adding…">
            Add members
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The group's details, members and everything its owner and admins can manage. */
export default function GroupDetails({ group, userId, onClose, onChanged }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(null); // edit | add | { type, member? }
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState({ variant: '', message: '' });

  const fetchMembers = useCallback((page) => listGroupMembers(group.id, page), [group.id]);
  const members = usePagedList(fetchMembers, group.id, GROUP_MEMBER_PAGE_SIZE);

  const isOwner = group.my_role === 'owner';
  const isManager = isOwner || group.my_role === 'admin';
  const isOnlyMember = group.member_count <= 1;

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
      await setGroupMemberRole(group.id, member.id, role);
      await Promise.all([members.refresh(), onChanged()]);
    } catch (error) {
      showError(error);
    }
  };

  const canRemove = (member) => {
    if (member.id === userId || member.role === 'owner') return false;
    return isOwner || (group.my_role === 'admin' && member.role !== 'admin');
  };

  return (
    <aside className="thread-info" aria-label="Group details">
      <header className="thread-info__header">
        <h2>Details</h2>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="thread-info__person">
        <GroupIcon size={64} />
        <p className="profile-head__name">{group.name}</p>
        <p className="row__meta">{memberCountLabel(group.member_count)}</p>
      </div>

      {notice.message && (
        <Alert variant={notice.variant} onDismiss={() => setNotice({ variant: '', message: '' })}>
          {notice.message}
        </Alert>
      )}

      <dl className="detail-list">
        <dt>Owner</dt>
        <dd>{group.owner_name || 'Not set'}</dd>
      </dl>
      {group.description && <p className="channel-description">{group.description}</p>}

      <div className="channel-actions">
        {isManager && (
          <>
            <Button variant="outline" onClick={() => setDialog('add')} leftIcon={<UserPlus size={16} aria-hidden="true" />}>
              Add members
            </Button>
            <Button variant="outline" onClick={() => setDialog('edit')} leftIcon={<Pencil size={16} aria-hidden="true" />}>
              Edit
            </Button>
          </>
        )}
        {(!isOwner || isOnlyMember) && (
          <Button variant="ghost" onClick={() => setDialog({ type: 'leave' })} leftIcon={<LogOut size={16} aria-hidden="true" />}>
            Leave
          </Button>
        )}
      </div>

      <section aria-label="Group members">
        <h3 className="channel-members__title">Members</h3>
        {members.status === 'loading' && <ListSkeleton rows={3} />}
        {members.status === 'error' && <Alert variant="error">{members.error}</Alert>}
        <ul className="channel-members">
          {members.items.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              userId={userId}
              subject="the group"
              canChangeRole={isOwner && member.id !== userId}
              canRemove={canRemove(member)}
              removeLabel="Remove"
              onToggleAdmin={() => changeRole(member, member.role === 'admin' ? 'member' : 'admin')}
              onMakeOwner={() => setDialog({ type: 'owner', member })}
              onRemove={() => setDialog({ type: 'remove', member })}
            />
          ))}
        </ul>
        {members.hasMore && (
          <div className="page__more">
            <Button variant="ghost" onClick={members.loadMore} isLoading={members.status === 'loadingMore'} loadingText="Loading…">
              Show more members
            </Button>
          </div>
        )}
      </section>

      <SharedFilesSection conversationId={group.id} />

      {dialog === 'edit' && <EditDialog group={group} onClose={() => setDialog(null)} onSaved={onChanged} />}

      {dialog === 'add' && (
        <AddDialog
          group={group}
          userId={userId}
          onClose={() => setDialog(null)}
          onAdded={async (count, requested) => {
            await Promise.all([members.refresh(), onChanged()]);
            const skipped = requested - count;
            setNotice({
              variant: 'success',
              message: `${count} ${count === 1 ? 'member' : 'members'} added.${
                skipped ? ` ${skipped} already in the group.` : ''
              }`,
            });
          }}
        />
      )}

      {dialog?.type === 'remove' && (
        <ConfirmDialog
          title="Remove member?"
          confirmLabel="Remove member"
          isBusy={isBusy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            runConfirmed(async () => {
              await removeGroupMember(group.id, dialog.member.id);
              await Promise.all([members.refresh(), onChanged()]);
            })
          }
        >
          {dialog.member.full_name} will immediately lose access to this group and all of its messages.
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
              await setGroupMemberRole(group.id, dialog.member.id, 'owner');
              await Promise.all([members.refresh(), onChanged()]);
            })
          }
        >
          {dialog.member.full_name} will own this group, and you will become an admin. Only they can undo this.
        </ConfirmDialog>
      )}

      {dialog?.type === 'leave' && (
        <ConfirmDialog
          title={isOnlyMember ? 'Leave and delete group?' : 'Leave group?'}
          confirmLabel={isOnlyMember ? 'Leave and delete' : 'Leave group'}
          isBusy={isBusy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            runConfirmed(async () => {
              await leaveGroup(group.id);
              // If this was the last member, the group's stored files are removed too.
              await purgePendingFiles().catch(() => {});
              await onChanged();
              navigate('/groups');
            })
          }
        >
          {isOnlyMember
            ? 'You are the last member, so this group and all of its messages will be permanently deleted.'
            : 'You will lose access to this group and its messages. A member would need to add you back.'}
        </ConfirmDialog>
      )}
    </aside>
  );
}
