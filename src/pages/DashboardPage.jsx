import { Link } from 'react-router-dom';
import { Bell, BookUser, FileText, Hash, MessageSquare, UserPlus, Users, UsersRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { APP_TAGLINE } from '../config/brand';
import './DashboardPage.css';

const SHORTCUTS = [
  { to: '/directory', icon: BookUser, title: 'Employee Directory', text: 'Find colleagues and connect with them.' },
  { to: '/connections', icon: Users, title: 'My Connections', text: 'See the colleagues you are connected with.' },
  { to: '/requests', icon: UserPlus, title: 'Connection Requests', text: 'Respond to requests and track yours.' },
  { to: '/documents', icon: FileText, title: 'Shared Documents', text: 'Find files from your chats and channels.' },
];

/** Home: a welcome and the quickest routes into the workspace. */
export default function DashboardPage() {
  const { user } = useAuth();
  const { unreadCount, unreadMessages, unreadChannels, unreadGroups } = useWorkspace();
  const firstName = user?.name?.split(' ')[0] || user?.username || 'there';

  return (
    <div className="page">
      <section className="welcome">
        <h1 className="welcome__title">Welcome, {firstName}</h1>
        <p className="welcome__tagline">{APP_TAGLINE}</p>
        <p className="welcome__account">
          Signed in as <strong>{user?.email || user?.username}</strong>
        </p>
      </section>

      <div className="home-grid">
        {SHORTCUTS.map(({ to, icon: Icon, title, text }) => (
          <Link key={to} to={to} className="home-card">
            <Icon size={22} aria-hidden="true" />
            <span className="home-card__title">{title}</span>
            <span className="home-card__text">{text}</span>
          </Link>
        ))}
        <Link to="/messages" className="home-card">
          <MessageSquare size={22} aria-hidden="true" />
          <span className="home-card__title">Direct Messages</span>
          <span className="home-card__text">
            {unreadMessages ? `${unreadMessages} unread` : 'You have no unread messages.'}
          </span>
        </Link>
        <Link to="/groups" className="home-card">
          <UsersRound size={22} aria-hidden="true" />
          <span className="home-card__title">Group Chats</span>
          <span className="home-card__text">
            {unreadGroups ? `${unreadGroups} unread` : 'You have no unread group messages.'}
          </span>
        </Link>
        <Link to="/channels/mine" className="home-card">
          <Hash size={22} aria-hidden="true" />
          <span className="home-card__title">My Channels</span>
          <span className="home-card__text">
            {unreadChannels ? `${unreadChannels} unread` : 'You have no unread channel messages.'}
          </span>
        </Link>
        <Link to="/notifications" className="home-card">
          <Bell size={22} aria-hidden="true" />
          <span className="home-card__title">Notifications</span>
          <span className="home-card__text">
            {unreadCount ? `${unreadCount} unread` : 'You have no unread notifications.'}
          </span>
        </Link>
      </div>
    </div>
  );
}
