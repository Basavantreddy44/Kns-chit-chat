import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import Alert from '../../components/common/Alert';
import Button from '../../components/common/Button';
import { EmptyState, PagedList, PageHeader } from '../../components/workspace/PageParts';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import { listNotifications, markNotificationsRead, PAGE_SIZE } from '../../services/employeeService';
import { formatDateTime } from '../../utils/format';

const destinationOf = ({ notification_type: type, reference_id: referenceId }) =>
  ({
    connection_request: '/requests',
    connection_accepted: '/connections',
    new_message: `/messages/${referenceId}`,
    missed_call: `/messages/${referenceId}`,
    channel_invitation: `/channels/${referenceId}`,
    channel_message: `/channels/${referenceId}`,
    channel_removed: '/channels',
    group_added: `/groups/${referenceId}`,
    group_message: `/groups/${referenceId}`,
    group_removed: '/groups',
  })[type] ?? '/notifications';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { unreadCount, lastEventAt, refreshUnread } = useWorkspace();
  const fetchPage = useCallback((page) => listNotifications(page), []);
  const list = usePagedList(fetchPage, 'notifications', PAGE_SIZE);
  const { refresh } = list;
  const [isMarking, setIsMarking] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (lastEventAt) refresh();
  }, [lastEventAt, refresh]);

  const openNotification = async (notification) => {
    try {
      if (!notification.is_read) {
        await markNotificationsRead(notification.id);
        await refreshUnread();
      }
    } catch {
      // Still take them there: being unread is not worth blocking on.
    }
    navigate(destinationOf(notification));
  };

  const markAllRead = async () => {
    setIsMarking(true);
    setActionError('');
    try {
      await markNotificationsRead();
      await Promise.all([refreshUnread(), refresh()]);
    } catch (error) {
      setActionError(error?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsMarking(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Notifications" subtitle={unreadCount ? `${unreadCount} unread` : 'You have no unread notifications.'}>
        <Button
          variant="outline"
          onClick={markAllRead}
          disabled={!unreadCount}
          isLoading={isMarking}
          loadingText="Marking…"
          leftIcon={<CheckCheck size={16} aria-hidden="true" />}
        >
          Mark all as read
        </Button>
      </PageHeader>

      {actionError && (
        <div className="page__stack" style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error" onDismiss={() => setActionError('')}>
            {actionError}
          </Alert>
        </div>
      )}

      <PagedList
        list={list}
        emptyState={
          <EmptyState icon={Bell} title="No notifications">
            Connection requests, messages and channel activity will appear here.
          </EmptyState>
        }
      >
        {list.items.map((notification) => (
          <li key={notification.id} className={`notification-item${notification.is_read ? '' : ' is-unread'}`}>
            <button type="button" className="notification" onClick={() => openNotification(notification)}>
              <span className="notification__dot" aria-hidden="true" />
              <span>
                <span className="notification__text">
                  {notification.is_read ? '' : <span className="sr-only">Unread: </span>}
                  {notification.message}
                </span>
                <br />
                <span className="notification__time">{formatDateTime(notification.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </PagedList>
    </div>
  );
}
