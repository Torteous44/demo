import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import './App.css';

// Import components
import Login from './components/auth/Login';
import AccessCode from './components/interview/AccessCode';
import InterviewDetails from './components/interview/InterviewDetails';
import Interview from './components/interview/Interview';
import Summary from './components/interview/Summary';
import RealtimeConnect from './components/interview/RealtimeConnect';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return null; // or a loading spinner
  }

  return (
    <div className="App">
      <Routes>
        <Route 
          path="/" 
          element={user ? <Navigate to="/access-code" replace /> : <Login />} 
        />
        
        {/* Protected routes */}
        <Route 
          path="/access-code" 
          element={user ? <AccessCode /> : <Navigate to="/" replace />} 
        />
        <Route 
          path="/interview-details/:hexCode" 
          element={user ? <InterviewDetails /> : <Navigate to="/" replace />} 
        />
        <Route 
          path="/interview/:id" 
          element={user ? <Interview /> : <Navigate to="/" replace />} 
        />
        <Route 
          path="/summary" 
          element={user ? <Summary /> : <Navigate to="/" replace />} 
        />
        <Route 
          path="/realtime-connect/:sessionId" 
          element={<RealtimeConnect />} 
        />

        {/* Catch all route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
