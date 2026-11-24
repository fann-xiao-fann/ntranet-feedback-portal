import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminDepartmentsPage } from './pages/AdminDepartmentsPage';
import { AdminFeedbackDetailPage } from './pages/AdminFeedbackDetailPage';
import { AdminFeedbackListPage } from './pages/AdminFeedbackListPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { LookupFeedbackPage } from './pages/LookupFeedbackPage';
import { SubmitFeedbackPage } from './pages/SubmitFeedbackPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SubmitFeedbackPage />} />
        <Route path="/lookup" element={<LookupFeedbackPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<Navigate to="/admin/feedbacks" replace />} />
        <Route path="/admin/feedbacks" element={<AdminFeedbackListPage />} />
        <Route path="/admin/feedbacks/:id" element={<AdminFeedbackDetailPage />} />
        <Route path="/admin/departments" element={<AdminDepartmentsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
