import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from './RouteGuards';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import DashboardPage from '../pages/DashboardPage';
import InfoPage from '../pages/InfoPage';
import NotFoundPage from '../pages/NotFoundPage';
import WorkspaceLayout from '../components/workspace/WorkspaceLayout';
import DirectoryPage from '../pages/workspace/DirectoryPage';
import ConnectionsPage from '../pages/workspace/ConnectionsPage';
import RequestsPage from '../pages/workspace/RequestsPage';
import ChannelsBrowsePage from '../pages/workspace/ChannelsBrowsePage';
import ChannelsPage from '../pages/workspace/ChannelsPage';
import CreateChannelPage from '../pages/workspace/CreateChannelPage';
import CreateGroupPage from '../pages/workspace/CreateGroupPage';
import GroupsPage from '../pages/workspace/GroupsPage';
import MessagesPage from '../pages/workspace/MessagesPage';
import NotificationsPage from '../pages/workspace/NotificationsPage';
import SharedDocumentsPage from '../pages/workspace/SharedDocumentsPage';
import { EmployeeProfilePage, MyProfilePage } from '../pages/workspace/ProfilePage';
import SettingsPage from '../pages/workspace/SettingsPage';

/** Central route table. Add messages, channels, etc. here later. */
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<RegisterPage />} />
        {/* Common alias so /register links also work */}
        <Route path="/register" element={<Navigate to="/signup" replace />} />
        <Route
          path="/forgot-password"
          element={<InfoPage title="Reset your password" message="Password recovery will be available soon." />}
        />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<WorkspaceLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:conversationId" element={<MessagesPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/new" element={<CreateGroupPage />} />
          <Route path="/groups/:groupId" element={<GroupsPage />} />
          <Route path="/channels" element={<ChannelsBrowsePage />} />
          <Route path="/channels/new" element={<CreateChannelPage />} />
          <Route path="/channels/mine" element={<ChannelsPage />} />
          <Route path="/channels/:channelId" element={<ChannelsPage />} />
          <Route path="/documents" element={<SharedDocumentsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<MyProfilePage />} />
          <Route path="/employees/:id" element={<EmployeeProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route
        path="/terms"
        element={<InfoPage title="Terms of Service" message="Your Terms of Service content goes here." />}
      />
      <Route
        path="/privacy"
        element={<InfoPage title="Privacy Policy" message="Your Privacy Policy content goes here." />}
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
