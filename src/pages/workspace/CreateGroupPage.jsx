import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { EmployeePicker } from '../../components/channels/ChannelParts';
import Alert from '../../components/common/Alert';
import Button from '../../components/common/Button';
import { GroupFields } from '../../components/groups/GroupDetails';
import { PageHeader } from '../../components/workspace/PageParts';
import { useAuth } from '../../context/AuthContext';
import { createGroup } from '../../services/groupService';

export default function CreateGroupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [values, setValues] = useState({ name: '', description: '' });
  const [members, setMembers] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [membersError, setMembersError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setNameError('');
    setMembersError('');
    if (values.name.trim().length < 2) {
      setNameError('Group names must be between 2 and 60 characters.');
      document.getElementById('group-name')?.focus();
      return;
    }
    if (!members.length) {
      setMembersError('Add at least one of your connections to the group.');
      document.getElementById('employee-picker')?.focus();
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const id = await createGroup({
        ...values,
        members: members.map((employee) => employee.id),
      });
      navigate(`/groups/${id}`, { replace: true });
    } catch (createError) {
      setIsSaving(false);
      setError(createError?.message || 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="page create-channel">
      <PageHeader title="Create Group" subtitle="A small conversation with colleagues you’re connected with." />
      <section className="card">
        <form className="form-stack" onSubmit={handleSubmit} noValidate>
          {error && <Alert variant="error">{error}</Alert>}
          <GroupFields values={values} onChange={setValues} disabled={isSaving} nameError={nameError} />
          <EmployeePicker
            selected={members}
            onChange={(next) => {
              setMembers(next);
              setMembersError('');
            }}
            disabled={isSaving}
            excludeId={user?.id}
            connectedOnly
            label="Add your connections"
          />
          {membersError && (
            <p className="field__error" role="alert">
              {membersError}
            </p>
          )}
          <p className="row__meta">
            You will be the group’s owner. Only people in <Link to="/connections">My Connections</Link> can be added.
          </p>
          <div>
            <Button type="submit" isLoading={isSaving} loadingText="Creating…" leftIcon={<Plus size={16} aria-hidden="true" />}>
              Create group
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
