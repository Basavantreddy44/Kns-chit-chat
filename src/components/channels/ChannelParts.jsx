import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Hash, Lock, Search, X } from 'lucide-react';
import { EmployeeAvatar } from '../workspace/EmployeeParts';
import { CHANNEL_CATEGORIES } from '../../config/channelCategories';
import { searchEmployees } from '../../services/employeeService';
import './channels.css';

const SEARCH_DELAY_MS = 300;

export function ChannelIcon({ channel, size = 40 }) {
  const Icon = channel.channel_type === 'private' ? Lock : Hash;
  return (
    <span className="channel-icon" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.48)} aria-hidden="true" />
    </span>
  );
}

export function ChannelTags({ channel }) {
  return (
    <>
      <span className="status-tag">{channel.channel_type === 'private' ? 'Private' : 'Public'}</span>
      {channel.category && <span className="status-tag">{channel.category}</span>}
      {channel.archived_at && <span className="status-tag status-tag--error">Archived</span>}
    </>
  );
}

export const memberCountLabel = (count) => `${count} ${count === 1 ? 'member' : 'members'}`;

/** Name, description and category: shared by creating and editing a channel. */
export function ChannelFields({ values, onChange, disabled, nameError }) {
  const set = (field) => (event) => onChange({ ...values, [field]: event.target.value });

  return (
    <>
      <label className="select-field">
        Channel name
        <input
          className="select"
          id="channel-name"
          maxLength={60}
          placeholder="e.g. QA & Testing"
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
        Description
        <textarea
          className="select channel-textarea"
          id="channel-description"
          maxLength={500}
          rows={3}
          placeholder="What is this channel for?"
          value={values.description}
          onChange={set('description')}
          disabled={disabled}
        />
      </label>
      <label className="select-field">
        Category
        <select className="select" id="channel-category" value={values.category} onChange={set('category')} disabled={disabled}>
          <option value="">No category</option>
          {CHANNEL_CATEGORIES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin' };

/**
 * A channel or group member, with whichever controls the viewer is allowed to use.
 * `subject` names the place in labels ("the channel" or "the group").
 */
export function MemberRow({ member, userId, canChangeRole, canRemove, removeLabel, subject, onToggleAdmin, onMakeOwner, onRemove }) {
  const isSelf = member.id === userId;
  const isInvited = member.membership_status === 'invited';

  return (
    <li className="channel-member">
      <div className="channel-member__top">
        <EmployeeAvatar employee={member} size={32} />
        <div className="row__body">
          {isSelf ? (
            <span className="picker__name">{member.full_name} (you)</span>
          ) : (
            <Link to={`/employees/${member.id}`} className="picker__name">
              {member.full_name}
            </Link>
          )}
          <p className="row__meta">{isInvited ? 'Invited' : ROLE_LABELS[member.role] ?? 'Member'}</p>
        </div>
      </div>
      {(canChangeRole || canRemove) && (
        <div className="channel-member__actions">
          {canChangeRole && (
            <>
              <button
                type="button"
                className="link-button"
                aria-label={`${member.role === 'admin' ? 'Remove admin role from' : 'Make admin:'} ${member.full_name}`}
                onClick={onToggleAdmin}
              >
                {member.role === 'admin' ? 'Remove admin' : 'Make admin'}
              </button>
              <button
                type="button"
                className="link-button"
                aria-label={`Make ${member.full_name} the owner`}
                onClick={onMakeOwner}
              >
                Make owner
              </button>
            </>
          )}
          {canRemove && (
            <button
              type="button"
              className="link-button"
              aria-label={`Remove ${member.full_name} from ${subject}`}
              onClick={onRemove}
            >
              {removeLabel}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Search for employees and collect a selection. `selected` holds employee objects.
 * `connectedOnly` limits results to the signed-in employee's connections.
 */
export function EmployeePicker({ selected, onChange, disabled, excludeId, label = 'Invite employees', connectedOnly = false }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'idle', results: [], error: '' });

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ status: 'idle', results: [], error: '' });
      return undefined;
    }
    let isActive = true;
    const timer = setTimeout(async () => {
      try {
        const results =
          (await searchEmployees({ search: trimmed, status: connectedOnly ? 'connected' : '', limit: 8 })) ?? [];
        if (isActive) setState({ status: 'ready', results, error: '' });
      } catch (error) {
        if (isActive) setState({ status: 'error', results: [], error: error?.message || 'Search failed.' });
      }
    }, SEARCH_DELAY_MS);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [query, connectedOnly]);

  const selectedIds = new Set(selected.map((employee) => employee.id));
  const results = state.results.filter((employee) => employee.id !== excludeId);

  const toggle = (employee) => {
    onChange(
      selectedIds.has(employee.id)
        ? selected.filter((item) => item.id !== employee.id)
        : [...selected, employee],
    );
  };

  return (
    <div className="select-field picker">
      <label htmlFor="employee-picker">{label}</label>
      <div className="filter-input">
        <Search size={16} aria-hidden="true" />
        <input
          id="employee-picker"
          type="search"
          placeholder="Search by name, username or department"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
        />
      </div>

      {selected.length > 0 && (
        <ul className="picker__chips" aria-label="Selected employees">
          {selected.map((employee) => (
            <li key={employee.id} className="picker__chip">
              {employee.full_name}
              <button
                type="button"
                className="picker__remove"
                aria-label={`Remove ${employee.full_name}`}
                onClick={() => toggle(employee)}
                disabled={disabled}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {state.status === 'error' && <p className="field__error">{state.error}</p>}
      {state.status === 'ready' && !results.length && (
        <p className="row__meta">
          {connectedOnly ? 'None of your connections match your search.' : 'No employees match your search.'}
        </p>
      )}
      {results.length > 0 && (
        <ul className="picker__results">
          {results.map((employee) => {
            const isSelected = selectedIds.has(employee.id);
            return (
              <li key={employee.id}>
                <button
                  type="button"
                  className="picker__result"
                  aria-pressed={isSelected}
                  onClick={() => toggle(employee)}
                  disabled={disabled}
                >
                  <EmployeeAvatar employee={employee} size={32} />
                  <span className="row__body">
                    <span className="picker__name">{employee.full_name}</span>
                    <span className="row__meta">
                      @{employee.username}
                      {employee.department ? ` · ${employee.department}` : ''}
                    </span>
                  </span>
                  {isSelected && <Check size={16} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
