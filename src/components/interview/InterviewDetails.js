import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './interviewdetails.module.css';

const InterviewDetails = () => {
  const { hexCode } = useParams();
  const navigate = useNavigate();
  const [interview, setInterview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);

  const BASE_URL = 'https://demobackend-p2e1.onrender.com';

  useEffect(() => {
    const fetchInterview = async () => {
      try {
        const response = await fetch(`${BASE_URL}/interviews/code/${hexCode}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        console.log(response);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to load interview');
        }

        const data = await response.json();
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
      
      const response = await fetch(`${BASE_URL}/sessions/start`, {
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
      
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to start session');
      }

      if (!data.id) {
        throw new Error('No session ID received');
      }

      navigate(`/realtime-connect/${data.id}`, {
        state: {
          title: interview.name,
          host: interview.organization_name,
          duration: interview.duration_minutes,
          price: '5.00'
        }
      });
    } catch (err) {
      console.error('Error starting session:', err);
      setError(err.message || 'Failed to start interview. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading interview details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={handleBack}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <button onClick={handleBack} className={styles.backButton}>
        <img src="/assets/backArrow.svg" alt="Back" />
        <span>Back</span>
      </button>

      <div className={styles.content}>
        <div className={styles.logo}>
          <img src="/assets/logo.svg" alt="Reach Logo" />
        </div>

        <h1 className={styles.title}>Hey there.</h1>
        <p className={styles.subtitle}>
          Welcome to Reach. We conduct AI user research<br />
          interviews through phone calls.
        </p>

        <div className={styles.signupText}>
          You're currently signed up for:
        </div>

        <div className={styles.interviewCard}>
          {interview.cover_image_url && !imageError && (
            <div className={styles.coverImageContainer}>
              <img 
                src={`${BASE_URL}${interview.cover_image_url}`}
                alt={interview.name}
                className={styles.coverImage}
                onError={() => setImageError(true)}
              />
              <div className={styles.priceTag}>${interview.price || '5.00'} call</div>
            </div>
          )}
          <div className={styles.interviewInfo}>
            <div className={styles.titleAndDuration}>
              <h2 className={styles.interviewTitle}>{interview.name}</h2>
              <span className={styles.duration}>{interview.duration_minutes} min</span>
            </div>
            <p className={styles.interviewHost}>
              {interview.organization_name || 'Reach Team'}
            </p>
          </div>
        </div>

        <div className={styles.actions}>
          <button 
            className={styles.secondaryButton}
            onClick={handleBack}
          >
            This is not my study
          </button>
          <button 
            className={styles.primaryButton}
            onClick={handleStart}
          >
            Start Interview
            <img 
              src="/assets/arrowRight.svg" 
              alt="" 
              className={styles.arrow_icon}
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export default InterviewDetails; 