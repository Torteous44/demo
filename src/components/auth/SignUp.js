import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import '../../styles/auth.css';

const SignUp = ({ switchToLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await register(email, password);
      if (result.success) {
        navigate('/access-code');
      } else {
        setError(result.error || 'Failed to create account');
      }
    } catch (err) {
      setError(err.message || 'Failed to create account');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="logo-container">
        <img src="/assets/logo.svg" alt="Reach Logo" className="logo-circle" />
      </div>
      
      <h1>Create your account</h1>
      <p className="subtitle">Sign up to start using Reach</p>

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
            placeholder="Create a password"
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
          Create account
          <img 
            src="/assets/arrowRight.svg" 
            alt="" 
            className="button-icon"
          />
        </button>
      </form>

      <p className="switch-auth">
        Already have an account?{' '}
        <button onClick={switchToLogin} className="switch-button">
          Sign in
        </button>
      </p>
    </div>
  );
};

export default SignUp; 