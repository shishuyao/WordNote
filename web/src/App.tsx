import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { ThemeProvider } from "./theme";
import { Spinner, ToastProvider } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import SentenceDetail from "./pages/SentenceDetail";
import Compose from "./pages/Compose";
import Wordbook from "./pages/Wordbook";
import WordDetail from "./pages/WordDetail";
import Review from "./pages/Review";
import SettingsPage from "./pages/Settings";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, authenticated } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-paper-500">
        <Spinner size={22} />
      </div>
    );
  }
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    document.title = "词笺 · Wordnote";
  }, []);
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/new" element={<Compose />} />
              <Route path="/sentences/:id" element={<SentenceDetail />} />
              <Route path="/words" element={<Wordbook />} />
              <Route path="/words/:id" element={<WordDetail />} />
              <Route path="/review" element={<Review />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
