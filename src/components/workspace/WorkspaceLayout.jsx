import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookUser,
  FileText,
  Hash,
  Home,
  ListPlus,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  User,
  UserPlus,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import BrandLogo from '../auth/BrandLogo';
import { CallLayer } from '../calls/CallParts';
import { CallProvider } from '../../context/CallContext';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace, WorkspaceProvider } from '../../context/WorkspaceContext';
import './workspace.css';

// Items with no `to` belong to later phases and are shown as coming soon.
const NAV_GROUPS = [
  {
    title: 'Workspace',
    items: [
      { label: 'Home', icon: Home, to: '/dashboard' },
      { label: 'Employee Directory', icon: BookUser, to: '/directory' },
      { label: 'My Connections', icon: Users, to: '/connections' },
      { label: 'Connection Requests', icon: UserPlus, to: '/requests' },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { label: 'Direct Messages', icon: MessageSquare, to: '/messages', badge: 'messages' },
      { label: 'Group Chats', icon: UsersRound, to: '/groups', badge: 'groups' },
    ],
  },
  {
    title: 'Channels',
    items: [
      { label: 'All Channels', icon: Hash, to: '/channels', end: true },
      { label: 'My Channels', icon: Hash, to: '/channels/mine', badge: 'channels', matchesChannel: true },
      { label: 'Create Channel', icon: ListPlus, to: '/channels/new' },
    ],
  },
  {
    title: 'Collaboration',
    items: [
      { label: 'Shared Documents', icon: FileText, to: '/documents' },
      { label: 'Notifications', icon: Bell, to: '/notifications', badge: 'notifications' },
    ],
  },
  {
    title: 'Personal',
    items: [
      { label: 'My Profile', icon: User, to: '/profile' },
      { label: 'Settings', icon: Settings, to: '/settings' },
    ],
  },
];

function UnreadBadge({ count }) {
  if (!count) return null;
  return <span className="unread-badge">{count > 99 ? '99+' : count}</span>;
}

function Shell() {
  const { logout } = useAuth();
  const { unreadCount, unreadMessages, unreadChannels, unreadGroups } = useWorkspace();
  const badgeCounts = {
    notifications: unreadCount,
    messages: unreadMessages,
    channels: unreadChannels,
    groups: unreadGroups,
  };
  const navigate = useNavigate();
  const location = useLocation();
  // An open channel belongs under My Channels in the navigation.
  const isInChannel = /^\/channels\/(?!new$)/.test(location.pathname);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    setIsNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isNavOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsNavOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isNavOpen]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      {isNavOpen && <div className="shell__backdrop" onClick={() => setIsNavOpen(false)} aria-hidden="true" />}

      <aside id="main-navigation" className={`sidebar${isNavOpen ? ' is-open' : ''}`}>
        <div className="sidebar__brand">
          <BrandLogo variant="light" size={32} />
          <button
            type="button"
            className="icon-button sidebar__close"
            aria-label="Close navigation"
            onClick={() => setIsNavOpen(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="nav-group">
              <p className="nav-group__title">{group.title}</p>
              {group.items.map(({ label, icon: Icon, to, badge, end, matchesChannel }) =>
                to ? (
                  <NavLink
                    key={label}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `nav-item${isActive || (matchesChannel && isInChannel) ? ' is-active' : ''}`
                    }
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-item__label">{label}</span>
                    {badge && <UnreadBadge count={badgeCounts[badge]} />}
                  </NavLink>
                ) : (
                  <span key={label} className="nav-item is-disabled" aria-disabled="true">
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-item__label">{label}</span>
                    <span className="nav-item__soon">Soon</span>
                  </span>
                ),
              )}
            </div>
          ))}
        </nav>

        <button type="button" className="nav-item sidebar__logout" onClick={handleLogout} disabled={isLoggingOut}>
          <LogOut size={18} aria-hidden="true" />
          <span className="nav-item__label">{isLoggingOut ? 'Logging out…' : 'Log out'}</span>
        </button>
      </aside>

      <div className="shell__content">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar__menu"
            aria-label="Open navigation"
            aria-expanded={isNavOpen}
            aria-controls="main-navigation"
            onClick={() => setIsNavOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="topbar__brand">
            <BrandLogo size={28} />
          </div>
          <NavLink
            to="/notifications"
            className="icon-button topbar__bell"
            aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          >
            <Bell size={20} aria-hidden="true" />
            <UnreadBadge count={unreadCount} />
          </NavLink>
        </header>

        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function WorkspaceLayout() {
  return (
    <WorkspaceProvider>
      <CallProvider>
        <Shell />
        <CallLayer />
      </CallProvider>
    </WorkspaceProvider>
  );
}
