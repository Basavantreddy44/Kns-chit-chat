import { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { BadgeCheck, Camera, UserX } from 'lucide-react';
import Alert from '../../components/common/Alert';
import Button from '../../components/common/Button';
import InputField from '../../components/common/InputField';
import { ConnectionActions, EmployeeAvatar } from '../../components/workspace/EmployeeParts';
import { EmptyState, ListSkeleton, PageHeader } from '../../components/workspace/PageParts';
import { DEPARTMENTS } from '../../config/departments';
import { useAuth } from '../../context/AuthContext';
import { AVATAR_INPUT_ACCEPT, removeProfilePicture, setProfilePicture } from '../../services/avatarService';
import { getEmployee, updateMyProfile } from '../../services/employeeService';

/** Loads one employee, and can reload after a change. */
function useEmployee(id) {
  const [state, setState] = useState({ status: 'loading', employee: null, error: '' });

  const load = useCallback(async () => {
    try {
      const employee = await getEmployee(id);
      setState({ status: 'ready', employee, error: '' });
    } catch (error) {
      setState({ status: 'error', employee: null, error: error?.message || 'Something went wrong.' });
    }
  }, [id]);

  useEffect(() => {
    setState({ status: 'loading', employee: null, error: '' });
    load();
  }, [load]);

  return { ...state, reload: load };
}

function ProfileHead({ employee, children }) {
  return (
    <div className="profile-head">
      <EmployeeAvatar employee={employee} size={64} />
      <div className="profile-head__body">
        <h2 className="profile-head__name">{employee.full_name}</h2>
        <p className="row__meta">@{employee.username}</p>
      </div>
      {children && <div className="row__actions">{children}</div>}
    </div>
  );
}

/** Another employee's profile. */
export function EmployeeProfilePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { status, employee, error, reload } = useEmployee(id);
  const [actionError, setActionError] = useState('');

  if (id === user?.id) return <Navigate to="/profile" replace />;

  return (
    <div className="page">
      <PageHeader title="Employee Profile" />
      {status === 'loading' && <ListSkeleton rows={1} />}
      {status === 'error' && (
        <Alert variant="error" title="Couldn’t load this profile">
          {error}
        </Alert>
      )}
      {status === 'ready' && !employee && (
        <EmptyState icon={UserX} title="Employee not found">
          This employee may no longer be registered.
        </EmptyState>
      )}
      {employee && (
        <div className="page__stack">
          {actionError && (
            <Alert variant="error" onDismiss={() => setActionError('')}>
              {actionError}
            </Alert>
          )}
          <section className="card">
            <ProfileHead employee={employee}>
              <ConnectionActions employee={employee} onChanged={reload} onError={setActionError} />
            </ProfileHead>
            <dl className="detail-list">
              <dt>Department</dt>
              <dd>{employee.department || 'Not set'}</dd>
              <dt>Designation</dt>
              <dd>{employee.designation || 'Not set'}</dd>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

function ProfilePictureControls({ employee, userId, onChanged, onResult }) {
  const [busy, setBusy] = useState('');

  const run = async (name, action, message) => {
    setBusy(name);
    onResult({ variant: '', message: '' });
    try {
      await action();
      await onChanged();
      onResult({ variant: 'success', message });
    } catch (error) {
      onResult({ variant: 'error', message: error?.message || 'Something went wrong.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="row__actions">
      <label className={`btn btn--outline avatar-upload${busy ? ' is-busy' : ''}`}>
        <Camera size={16} aria-hidden="true" />
        <span>{busy === 'upload' ? 'Uploading…' : employee.avatar_url ? 'Change picture' : 'Add picture'}</span>
        <input
          type="file"
          className="sr-only"
          accept={AVATAR_INPUT_ACCEPT}
          disabled={Boolean(busy)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) run('upload', () => setProfilePicture(userId, file), 'Your picture has been updated.');
          }}
        />
      </label>
      {employee.avatar_url && (
        <Button
          variant="ghost"
          disabled={Boolean(busy)}
          isLoading={busy === 'remove'}
          loadingText="Removing…"
          onClick={() => run('remove', removeProfilePicture, 'Your picture has been removed.')}
        >
          Remove picture
        </Button>
      )}
    </div>
  );
}

/** The signed-in employee's own profile, with the fields they can edit. */
export function MyProfilePage() {
  const { user } = useAuth();
  const { status, employee, error, reload } = useEmployee(user?.id);
  const [form, setForm] = useState({ department: '', designation: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState({ variant: '', message: '' });

  useEffect(() => {
    if (employee) setForm({ department: employee.department || '', designation: employee.designation || '' });
  }, [employee]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setSaveResult({ variant: '', message: '' });
    try {
      await updateMyProfile(user.id, form);
      await reload();
      setSaveResult({ variant: 'success', message: 'Your profile has been saved.' });
    } catch (saveError) {
      setSaveResult({ variant: 'error', message: saveError?.message || 'Something went wrong.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="My Profile" subtitle="Your department and designation help colleagues find you." />
      {status === 'loading' && <ListSkeleton rows={1} />}
      {status === 'error' && (
        <Alert variant="error" title="Couldn’t load your profile">
          {error}
        </Alert>
      )}
      {employee && (
        <section className="card">
          <ProfileHead employee={employee}>
            <ProfilePictureControls employee={employee} userId={user.id} onChanged={reload} onResult={setSaveResult} />
          </ProfileHead>
          <dl className="detail-list" style={{ marginBottom: 'var(--space-5)' }}>
            <dt>Email</dt>
            <dd>{user?.email}</dd>
          </dl>

          <form className="form-stack" onSubmit={handleSubmit}>
            {saveResult.message && (
              <Alert variant={saveResult.variant} onDismiss={() => setSaveResult({ variant: '', message: '' })}>
                {saveResult.message}
              </Alert>
            )}
            <label className="select-field">
              Department
              <select
                className="select"
                value={form.department}
                onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))}
                disabled={isSaving}
              >
                <option value="">Not set</option>
                {DEPARTMENTS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <InputField
              id="designation"
              label="Designation"
              placeholder="e.g. Senior Engineer"
              maxLength={80}
              value={form.designation}
              onChange={(event) => setForm((prev) => ({ ...prev, designation: event.target.value }))}
              disabled={isSaving}
            />
            <div>
              <Button
                type="submit"
                isLoading={isSaving}
                loadingText="Saving…"
                leftIcon={<BadgeCheck size={16} aria-hidden="true" />}
              >
                Save changes
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
