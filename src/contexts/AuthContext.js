import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in on mount
    const checkAuth = () => {
      const token = localStorage.getItem('token');
      const userInfo = localStorage.getItem('user_info');
      
      console.log('Checking auth - Token:', !!token, 'UserInfo:', !!userInfo);
      
      if (token && userInfo) {
        try {
          const parsedUser = JSON.parse(userInfo);
          console.log('Setting user:', parsedUser);
          setUser(parsedUser);
        } catch (err) {
          console.log('Error parsing user info:', err);
          localStorage.removeItem('token');
          localStorage.removeItem('user_info');
          setUser(null);
        }
      } else {
        console.log('No token or user info found');
        setUser(null);
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    try {
      console.log('Attempting login for:', email);
      const resp = await fetch("https://demobackend-p2e1.onrender.comauth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const data = await resp.json();
      console.log('Login response:', data);

      if (!resp.ok) {
        return { success: false, error: data.detail || "Invalid credentials" };
      }

      // Store the token
      localStorage.setItem("token", data.access_token);
      
      // Use the full user info returned by the backend
      if (data.user) {
        localStorage.setItem("user_info", JSON.stringify(data.user));
        console.log('Setting user after login:', data.user);
        setUser(data.user);
      }

      return { success: true };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, error: err.message };
    }
  };

  const register = async (email, password) => {
    try {
      const resp = await fetch("https://demobackend-p2e1.onrender.comauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!resp.ok) {
        const errorData = await resp.json();
        throw new Error(errorData.detail || "Registration failed");
      }

      const data = await resp.json();
      localStorage.setItem("token", data.access_token);
      
      if (data.user) {
        localStorage.setItem("user_info", JSON.stringify(data.user));
        setUser(data.user);
      }

      return { success: true };
    } catch (err) {
      console.error('Registration error:', err);
      return { success: false, error: err.message };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user_info');
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
