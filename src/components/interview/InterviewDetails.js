import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './interviewdetails.module.css';

const InterviewDetails = () => {
  const { hexCode } = useParams();
  const navigate = useNavigate();
  const [interview, setInterview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchInterview = async () => {
      try {
        console.log('Fetching interview with code:', hexCode);
        
        const response = await fetch(`https://demobackend-p2e1.onrender.com/interviews/code/${hexCode}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const data = await response.json();
        console.log('Interview data:', data);
        
        if (!response.ok) {
          throw new Error(data.detail || 'Failed to load interview');
        }

        setInterview(data);
      } catch (err) {
        console.error('Error fetching interview:', err);
        setError(err.message || 'Failed to load interview');
      } finally {
        setIsLoading(false);
      }
    };

    if (hexCode) {
      fetchInterview();
    }
  }, [hexCode]);

  const handleBack = () => {
    navigate('/access-code');
  };

  const handleStart = async () => {
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch('https://demobackend-p2e1.onrender.com/sessions/start', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          interview_id: interview.id
        })
      });

      const data = await response.json();
      console.log('Session start response:', data);
      
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to start session');
      }

      if (!data.id) {
        throw new Error('No session ID received');
      }

      navigate(`/realtime-connect/${data.id}`);
    } catch (err) {
      console.error('Error starting session:', err);
      setError(err.message || 'Failed to start interview. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className={styles.details_container}>
        <div className={styles.loading}>Loading interview details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.details_container}>
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={handleBack}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.details_container}>
      <button onClick={handleBack} className={styles.back_button}>
        ← Back
      </button>

      <div className={styles.details_content}>
        <img src="/assets/logo.svg" alt="Reach Logo" className={styles.details_logo} />
        
        <h1>Hey there.</h1>
        <p className={styles.welcome_text}>
          Welcome to Reach. We conduct AI user research<br />
          interviews through phone calls.
        </p>

        <div className={styles.interview_card}>
          <p className={styles.status_text}>You're currently signed up for:</p>
          
          <div className={styles.interview_info}>
            <div className={styles.interview_details}>
              <h2>{interview.name}</h2>
              <div className={styles.interview_scope}>
                <h3>Scope</h3>
                <p>{interview.scope}</p>
              </div>
              <div className={styles.interview_description}>
                <h3>Description</h3>
                <p>{interview.description}</p>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.action_buttons}>
          <button 
            className={styles.secondary_button}
            onClick={handleBack}
          >
            This is not my study
          </button>
          <button 
            onClick={handleStart} 
            className={styles.primary_button}
          >
            Start Interview →
          </button>
        </div>

        <footer className={styles.details_footer}>
          <a href="/need-help">Need help?</a>
          <a href="/about-reach">About Reach</a>
        </footer>
      </div>
    </div>
  );
};

export default InterviewDetails; 