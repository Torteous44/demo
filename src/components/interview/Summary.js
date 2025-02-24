import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './summary.module.css';

const Summary = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.summary_container}>
      <div className={styles.summary_content}>
        <div className={styles.logo_container}>
          <img src="/assets/logo.svg" alt="Logo" className={styles.logo} />
        </div>
        
        <h1>You're done!</h1>
        
        <p className={styles.message}>
          Thanks for your time and effort, Max.
          <br />
          You will be receiving a payout in the next 24 hours. If you need any help make sure to contact us.
        </p>

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