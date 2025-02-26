import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styles from './summary.module.css';

const Summary = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const duration = location.state?.duration || '0:00';

  return (
    <div className={styles.summary_container}>
      <div className={styles.summary_content}>
        <div className={styles.logo_container}>
          <img src="assets/logo.svg" alt="Logo" className={styles.logo} />
        </div>
        
        <h1>You're done!</h1>
        
        <div className={styles.message_container}>
          <p className={styles.timer_text}>
            Your interview lasted {duration}
          </p>
          
          <p className={styles.message}>
            You will be receiving a payout in the next 24 hours. If you need any help make sure to contact us.
          </p>
        </div>

        <div className={styles.button_group}>
          <button 
            className={styles.primary_button}
            onClick={() => navigate('/access-code')}
          >
            Go home →
          </button>
          
          <button 
            className={styles.secondary_button}
            onClick={() => navigate('/contact')}
          >
            Contact us
          </button>
        </div>
      </div>
    </div>
  );
};

export default Summary; 