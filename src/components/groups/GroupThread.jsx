import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Info, Search, UsersRound, X } from 'lucide-react';
import { memberCountLabel } from '../channels/ChannelParts';
import { DropOverlay, UploadQueue, useFileDrop } from '../files/FileParts';
import { Composer, MessageList, ThreadSearch } from '../messaging/MessageParts';
import { useMessageThread } from '../../hooks/useMessageThread';
import { useSenders } from '../../hooks/useSenders';
import { useFileUploads, useMessageFiles } from '../../hooks/useThreadFiles';
import { shareConversationFile } from '../../services/fileService';
import { listGroupMessages, markGroupRead, searchGroupMessages, sendGroupMessage } from '../../services/groupService';
import { MESSAGE_PAGE_SIZE } from '../../services/messagingService';
import '../channels/channels.css';

export function GroupIcon({ size = 40 }) {
  return (
    <span className="channel-icon" style={{ width: size, height: size }}>
      <UsersRound size={Math.round(size * 0.48)} aria-hidden="true" />
    </span>
  );
}

/** One group conversation. */
export default function GroupThread({ group, userId, isInfoOpen, onToggleInfo, onActivity }) {
  const groupId = group.id;
  const source = useMemo(
    () => ({
      eventType: 'message',
      belongs: (row) => row.conversation_id === groupId,
      fetchPage: (before) => listGroupMessages(groupId, before),
      post: (content, clientId) => sendGroupMessage(groupId, content, clientId),
      markRead: () => markGroupRead(groupId),
      draftFields: { conversation_id: groupId },
      pageSize: MESSAGE_PAGE_SIZE,
    }),
    [groupId],
  );

  const thread = useMessageThread(source, userId);
  const senderOf = useSenders(thread.messages);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const search = useCallback((query) => searchGroupMessages(groupId, query), [groupId]);

  const uploadTarget = useMemo(
    () => ({
      prefix: `conversations/${groupId}`,
      share: (path, name, clientId) => shareConversationFile(groupId, path, name, clientId),
    }),
    [groupId],
  );
  const uploads = useFileUploads(uploadTarget, thread.receive);
  const files = useMessageFiles(thread.messages, 'conversation');
  const { isDragging, dropProps } = useFileDrop(uploads.addFiles, true);

  return (
    <section className="thread" aria-label={`Group ${group.name}`} {...dropProps}>
      {isDragging && <DropOverlay />}
      <header className="thread__header">
        <Link to="/groups" className="icon-button thread__back" aria-label="Back to group chats">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <GroupIcon size={38} />
        <div className="row__body">
          <h1 className="thread__title">{group.name}</h1>
          <p className="row__meta">{memberCountLabel(group.member_count)}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Search this group"
          aria-expanded={isSearchOpen}
          onClick={() => setIsSearchOpen((open) => !open)}
        >
          {isSearchOpen ? <X size={20} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Group details"
          aria-expanded={isInfoOpen}
          onClick={onToggleInfo}
        >
          <Info size={20} aria-hidden="true" />
        </button>
      </header>

      {isSearchOpen && <ThreadSearch search={search} label="Search this group" onClose={() => setIsSearchOpen(false)} />}

      <MessageList
        thread={thread}
        userId={userId}
        senderOf={senderOf}
        labelFor={(message) => (message.pending && !message.failed ? 'Sending…' : '')}
        onActivity={onActivity}
        files={files}
        emptyState={
          <div className="empty">
            <GroupIcon size={56} />
            <h2 className="empty__title">Welcome to {group.name}</h2>
            <p>{group.description || 'Send the first message to get things started.'}</p>
          </div>
        }
      />

      <UploadQueue uploads={uploads.uploads} onRetry={uploads.retry} onCancel={uploads.cancel} onDismiss={uploads.dismiss} />

      <Composer
        disabled={thread.status !== 'ready'}
        onSend={thread.send}
        onAttach={uploads.addFiles}
        placeholder={`Message ${group.name}…`}
      />
    </section>
  );
}
