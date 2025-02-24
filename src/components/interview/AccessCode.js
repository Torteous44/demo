import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './accesscode.module.css';

const AccessCode = () => {
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleAccessCodeChange = (e) => {
    const value = e.target.value.toUpperCase(); // Convert to uppercase
    if (value.length <= 4) { // Limit to 4 characters
      setAccessCode(value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (accessCode.length !== 4) {
      setError('Please enter a 4-character access code');
      return;
    }
    
    setError('');
    setIsLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`https://demobackend-p2e1.onrender.com/interviews/code/${accessCode}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || 'Invalid access code');
      }

      navigate(`/interview-details/${accessCode}`);
      
    } catch (err) {
      console.error('Error fetching interview:', err);
      setError('Invalid access code. Please check and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.access_page}>
      <div className={styles.access_content}>
        <div className={styles.content_wrapper}>
          <div className={styles.main_content}>
            <h1>Reach Interviews</h1>
            <p className={styles.access_subtitle}>
              <strong>Hey there.</strong> We just need your access code associated with the interview you're taking to get started.
            </p>

            <form onSubmit={handleSubmit} className={styles.access_form}>
              {error && <div className={styles.error_message}>{error}</div>}
              
              <div className={styles.input_group}>
                <img 
                  src="/assets/accesscode.svg" 
                  alt="" 
                  className={styles.input_icon}
                />
                <input
                  type="text"
                  value={accessCode}
                  onChange={handleAccessCodeChange}
                  placeholder="Enter your access code"
                  className={styles.access_input}
                  disabled={isLoading}
                  maxLength="4"
                  pattern="[A-Za-z0-9]{4}"
                  autoCapitalize="characters"
                />
              </div>

              <button 
                type="submit" 
                className={styles.submit_button}
                disabled={isLoading || accessCode.length !== 4}
              >
                {isLoading ? 'Loading...' : 'Submit →'}
              </button>
            </form>
          </div>

          <footer className={styles.access_footer}>
            <a href="/need-help">Need help?</a>
            <a href="/about-reach">About Reach</a>
          </footer>
        </div>
      </div>

      <div className={styles.decorative_grid}>
        {[...Array(100)].map((_, index) => (
          <div key={index} className={styles.grid_cell} />
        ))}
      </div>
    </div>
  );
};

export default AccessCode; 