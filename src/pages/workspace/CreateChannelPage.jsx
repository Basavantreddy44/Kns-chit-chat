import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock, Plus } from 'lucide-react';
import { ChannelFields, EmployeePicker } from '../../components/channels/ChannelParts';
import Alert from '../../components/common/Alert';
import Button from '../../components/common/Button';
import { PageHeader } from '../../components/workspace/PageParts';
import { useAuth } from '../../context/AuthContext';
import { createChannel } from '../../services/channelService';

const NAME_TAKEN = 'A public channel with this name already exists. Please choose another.';

export default function CreateChannelPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [values, setValues] = useState({ name: '', description: '', category: '' });
  const [type, setType] = useState('public');
  const [members, setMembers] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (values.name.trim().length < 2) {
      setNameError('Channel names must be between 2 and 60 characters.');
      document.getElementById('channel-name')?.focus();
      return;
    }
    setIsSaving(true);
    setError('');
    setNameError('');
    try {
      const id = await createChannel({
        ...values,
        type,
        members: members.map((employee) => employee.id),
      });
      navigate(`/channels/${id}`, { replace: true });
    } catch (createError) {
      setIsSaving(false);
      if (createError?.message === NAME_TAKEN) setNameError(NAME_TAKEN);
      else setError(createError?.message || 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="page create-channel">
      <PageHeader title="Create Channel" subtitle="A shared space for a department, project or group of colleagues." />
      <section className="card">
        <form className="form-stack" onSubmit={handleSubmit} noValidate>
          {error && <Alert variant="error">{error}</Alert>}

          <ChannelFields values={values} onChange={setValues} disabled={isSaving} nameError={nameError} />

          <fieldset className="type-options" disabled={isSaving}>
            <legend>Channel type</legend>
            <label className="type-option">
              <input type="radio" name="channel-type" value="public" checked={type === 'public'} onChange={() => setType('public')} />
              <span>
                <span className="type-option__title">
                  <Hash size={14} aria-hidden="true" /> Public
                </span>
                <span className="row__meta">Any employee can find and join it.</span>
              </span>
            </label>
            <label className="type-option">
              <input type="radio" name="channel-type" value="private" checked={type === 'private'} onChange={() => setType('private')} />
              <span>
                <span className="type-option__title">
                  <Lock size={14} aria-hidden="true" /> Private
                </span>
                <span className="row__meta">Only people you invite can see it.</span>
              </span>
            </label>
          </fieldset>

          <EmployeePicker
            selected={members}
            onChange={setMembers}
            disabled={isSaving}
            excludeId={user?.id}
            label="Invite employees (optional)"
          />

          <p className="row__meta">You will be the channel’s owner. Invited employees choose whether to join.</p>

          <div>
            <Button type="submit" isLoading={isSaving} loadingText="Creating…" leftIcon={<Plus size={16} aria-hidden="true" />}>
              Create channel
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
