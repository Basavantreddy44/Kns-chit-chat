import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Clock, MessageSquare, UserPlus, X } from 'lucide-react';
import Button from '../common/Button';
import { useWorkspace } from '../../context/WorkspaceContext';
import { avatarUrl } from '../../services/avatarService';
import { cancelRequest, respondToRequest, sendConnectionRequest } from '../../services/employeeService';
import { startDirectConversation } from '../../services/messagingService';

function getInitials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  const initials = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

export function EmployeeAvatar({ employee, size = 44 }) {
  const { onlineIds } = useWorkspace();
  const isOnline = onlineIds.has(employee.id);

  return (
    <span className="employee-avatar" style={{ width: size, height: size }}>
      {employee.avatar_url ? (
        <img src={avatarUrl(employee.avatar_url)} alt="" loading="lazy" />
      ) : (
        <span aria-hidden="true">{getInitials(employee.full_name)}</span>
      )}
      <span
        className={`employee-avatar__status${isOnline ? ' is-online' : ''}`}
        title={isOnline ? 'Online' : 'Offline'}
        aria-hidden="true"
      />
    </span>
  );
}

/** One employee: avatar, name, role and online status. Actions go in `children`. */
export function EmployeeRow({ employee, children }) {
  const { onlineIds } = useWorkspace();
  const role = [employee.designation, employee.department].filter(Boolean).join(' · ');

  return (
    <li className="row">
      <EmployeeAvatar employee={employee} />
      <div className="row__body">
        <Link to={`/employees/${employee.id}`} className="row__name">
          {employee.full_name}
        </Link>
        <p className="row__meta">@{employee.username}</p>
        <p className="row__meta">{role || 'Department not set'}</p>
        <p className="row__meta">{onlineIds.has(employee.id) ? 'Online' : 'Offline'}</p>
      </div>
      {children && <div className="row__actions">{children}</div>}
    </li>
  );
}

/**
 * The right button for where the viewer stands with this employee. After any
 * action it calls onChanged, so the parent can fetch the current state.
 */
export function ConnectionActions({ employee, onChanged, onError }) {
  const [busyAction, setBusyAction] = useState('');
  const { refreshUnread } = useWorkspace();

  const run = async (name, action) => {
    setBusyAction(name);
    onError?.('');
    try {
      await action();
      await refreshUnread();
      await onChanged?.();
    } catch (error) {
      onError?.(error?.message || 'Something went wrong. Please try again.');
      await onChanged?.();
    } finally {
      setBusyAction('');
    }
  };

  switch (employee.connection_status) {
    case 'none':
      return (
        <Button
          onClick={() => run('send', () => sendConnectionRequest(employee.id))}
          isLoading={busyAction === 'send'}
          loadingText="Sending…"
          leftIcon={<UserPlus size={16} aria-hidden="true" />}
        >
          Send Connection Request
        </Button>
      );
    case 'request_sent':
      return (
        <>
          <span className="status-tag">
            <Clock size={14} aria-hidden="true" /> Request Sent
          </span>
          <Button
            variant="ghost"
            onClick={() => run('cancel', () => cancelRequest(employee.request_id))}
            isLoading={busyAction === 'cancel'}
            loadingText="Cancelling…"
            aria-label={`Cancel request to ${employee.full_name}`}
          >
            Cancel
          </Button>
        </>
      );
    case 'request_received':
      return (
        <>
          <Button
            onClick={() => run('accept', () => respondToRequest(employee.request_id, true))}
            isLoading={busyAction === 'accept'}
            loadingText="Accepting…"
            disabled={Boolean(busyAction)}
            leftIcon={<Check size={16} aria-hidden="true" />}
          >
            Accept Request
          </Button>
          <Button
            variant="outline"
            onClick={() => run('reject', () => respondToRequest(employee.request_id, false))}
            isLoading={busyAction === 'reject'}
            loadingText="Rejecting…"
            disabled={Boolean(busyAction)}
            leftIcon={<X size={16} aria-hidden="true" />}
            aria-label={`Reject request from ${employee.full_name}`}
          >
            Reject
          </Button>
        </>
      );
    case 'connected':
      return (
        <>
          <span className="status-tag status-tag--success">
            <Check size={14} aria-hidden="true" /> Connected
          </span>
          <StartChatButton employee={employee} onError={onError} />
        </>
      );
    case 'request_declined':
      return <span className="status-tag">Request declined</span>;
    default:
      return null;
  }
}

/** Opens this employee's conversation, creating it the first time. */
export function StartChatButton({ employee, label = 'Start Chat', onError }) {
  const navigate = useNavigate();
  const [isOpening, setIsOpening] = useState(false);

  const openChat = async () => {
    setIsOpening(true);
    onError?.('');
    try {
      const conversationId = await startDirectConversation(employee.id);
      navigate(`/messages/${conversationId}`);
    } catch (error) {
      setIsOpening(false);
      onError?.(error?.message || 'Something went wrong. Please try again.');
    }
  };

  return (
    <Button
      variant="outline"
      onClick={openChat}
      isLoading={isOpening}
      loadingText="Opening…"
      leftIcon={<MessageSquare size={16} aria-hidden="true" />}
      aria-label={`${label} with ${employee.full_name}`}
    >
      {label}
    </Button>
  );
}
