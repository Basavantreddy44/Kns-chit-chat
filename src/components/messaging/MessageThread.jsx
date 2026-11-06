import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Info, Search, X } from 'lucide-react';
import { Composer, MessageList, ThreadSearch } from './MessageParts';
import { CallButtons } from '../calls/CallParts';
import { DropOverlay, UploadQueue, useFileDrop } from '../files/FileParts';
import { EmployeeAvatar } from '../workspace/EmployeeParts';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useConversationThread } from '../../hooks/useConversationThread';
import { useFileUploads, useMessageFiles } from '../../hooks/useThreadFiles';
import { shareConversationFile } from '../../services/fileService';
import { searchMessages } from '../../services/messagingService';

export function toEmployee(conversation) {
  return {
    id: conversation.employee_id,
    username: conversation.username,
    full_name: conversation.full_name || 'Former employee',
    department: conversation.department,
    designation: conversation.designation,
    avatar_url: conversation.avatar_url,
  };
}

function deliveryLabel(message, otherLastReadAt) {
  if (message.failed) return '';
  if (message.pending) return 'Sending…';
  return otherLastReadAt && new Date(otherLastReadAt) >= new Date(message.created_at) ? 'Read' : 'Sent';
}

/** One direct conversation. */
export default function MessageThread({ conversation, userId, onToggleInfo, isInfoOpen, onActivity }) {
  const employee = toEmployee(conversation);
  const { onlineIds, subscribeToMessages } = useWorkspace();
  const thread = useConversationThread(conversation.id, userId);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(
    () =>
      subscribeToMessages(({ type, row }) => {
        if (type === 'read' && row.conversation_id === conversation.id && row.employee_id === userId) onActivity?.();
      }),
    [subscribeToMessages, conversation.id, userId, onActivity],
  );

  const search = useCallback((query) => searchMessages(conversation.id, query), [conversation.id]);

  const uploadTarget = useMemo(
    () => ({
      prefix: `conversations/${conversation.id}`,
      share: (path, name, clientId) => shareConversationFile(conversation.id, path, name, clientId),
    }),
    [conversation.id],
  );
  const uploads = useFileUploads(uploadTarget, thread.receive);
  const files = useMessageFiles(thread.messages, 'conversation');
  const { isDragging, dropProps } = useFileDrop(uploads.addFiles, conversation.is_connected);

  const readAt = thread.otherLastReadAt ?? conversation.other_last_read_at;
  const lastOwn = [...thread.messages]
    .reverse()
    .find((message) => message.sender_id === userId && !message.failed && message.message_type !== 'call');

  return (
    <section className="thread" aria-label={`Conversation with ${employee.full_name}`} {...dropProps}>
      {isDragging && <DropOverlay />}
      <header className="thread__header">
        <Link to="/messages" className="icon-button thread__back" aria-label="Back to conversations">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <EmployeeAvatar employee={employee} size={38} />
        <div className="row__body">
          <h1 className="thread__title">{employee.full_name}</h1>
          <p className="row__meta">{onlineIds.has(employee.id) ? 'Online' : 'Offline'}</p>
        </div>
        <CallButtons employee={employee} disabled={!conversation.is_connected} />
        <button
          type="button"
          className="icon-button"
          aria-label="Search this conversation"
          aria-expanded={isSearchOpen}
          onClick={() => setIsSearchOpen((open) => !open)}
        >
          {isSearchOpen ? <X size={20} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Conversation details"
          aria-expanded={isInfoOpen}
          onClick={onToggleInfo}
        >
          <Info size={20} aria-hidden="true" />
        </button>
      </header>

      {isSearchOpen && <ThreadSearch search={search} onClose={() => setIsSearchOpen(false)} />}

      <MessageList
        thread={thread}
        userId={userId}
        senderOf={() => employee}
        labelFor={(message) => (message === lastOwn ? deliveryLabel(message, readAt) : '')}
        onActivity={onActivity}
        files={files}
        emptyState={
          <div className="empty">
            <EmployeeAvatar employee={employee} size={56} />
            <h2 className="empty__title">Start your conversation with {employee.full_name}</h2>
            <p>Messages you send will appear here.</p>
          </div>
        }
      />

      <UploadQueue uploads={uploads.uploads} onRetry={uploads.retry} onCancel={uploads.cancel} onDismiss={uploads.dismiss} />

      {conversation.is_connected ? (
        <Composer disabled={thread.status !== 'ready'} onSend={thread.send} onAttach={uploads.addFiles} />
      ) : (
        <p className="thread__blocked">
          You and {employee.full_name} are no longer connected, so you can read this history but can’t send new
          messages. <Link to={`/employees/${employee.id}`}>View profile</Link>
        </p>
      )}
    </section>
  );
}
