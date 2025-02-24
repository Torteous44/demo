import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import SignUp from './SignUp';
import '../../styles/auth.css';

const Login = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await login(email, password);
      
      if (result.success) {
        navigate('/access-code', { replace: true });
      } else {
        setError(result.error || 'Failed to sign in');
      }
    } catch (err) {
      setError('An unexpected error occurred');
      console.error('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLogin) {
    return (
      <div className="auth-container">
        <SignUp switchToLogin={() => setIsLogin(true)} />
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="logo-container">
          <img src="/assets/logo.svg" alt="Reach Logo" className="logo-circle" />
        </div>
        
        <h1>Sign in to Reach</h1>
        <p className="subtitle">Sign in to your user profile at Reach</p>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group">
            <img 
              src="/assets/profileIcon.svg" 
              alt="" 
              className="input-icon"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              className="auth-input"
              disabled={isLoading}
            />
          </div>

          <div className="input-group">
            <img 
              src="/assets/keyIcon.svg" 
              alt="" 
              className="input-icon"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="auth-input"
              disabled={isLoading}
            />
          </div>

          <button 
            type="submit" 
            className="continue-button"
            disabled={isLoading}
          >
            Continue
            <img 
              src="/assets/arrowRight.svg" 
              alt="" 
              className="button-icon"
            />
          </button>
        </form>

        <p className="switch-auth">
          Don't have an account?{' '}
          <button onClick={() => setIsLogin(false)} className="switch-button">
            Sign up
          </button>
        </p>
      </div>
    </div>
  );
};

export default Login; 