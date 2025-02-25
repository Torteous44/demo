import React, { useRef, useEffect, useState } from 'react';

function AudioVisualizer({ mediaStream }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 400, height: 400 });

  // Resize handler to maintain square aspect ratio
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const size = Math.min(containerWidth, 400); // Cap at 400px
        setCanvasDimensions({ width: size, height: size });
      }
    };

    // Initial sizing
    handleResize();
    
    // Add resize listener
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Check if mediaStream exists and has audio tracks
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      console.log('No audio tracks available yet');
      setHasAudioTrack(false);
      return;
    }

    setHasAudioTrack(true);
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(mediaStream);
    
    source.connect(analyser);
    
    // Configure for volume detection
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Create initial random lengths for bars
    const numLines = 100;
    const randomFactors = Array.from({ length: numLines }, () => Math.random() * 0.5 + 0.5);

    function draw() {
      analyser.getByteFrequencyData(dataArray);

      // Calculate average volume
      const volume = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
      
      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;
      const centerX = WIDTH / 2;
      const centerY = HEIGHT / 2;
      const baseRadius = Math.min(WIDTH, HEIGHT) * 0.3;

      // Clear canvas
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      // Draw lines
      const angleStep = (2 * Math.PI) / numLines;
      const minLength = baseRadius * 0.15; // Minimum line length
      const maxLengthAdd = baseRadius * 0.5; // Maximum additional length

      ctx.strokeStyle = '#007BFF';
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';

      for (let i = 0; i < numLines; i++) {
        const angle = i * angleStep - Math.PI / 2;
        
        // Calculate line length using volume and random factor
        const volumeFactor = volume / 255;
        const lineLength = minLength + (maxLengthAdd * volumeFactor * randomFactors[i]);
        
        // Calculate start point (inner circle)
        const startX = centerX + baseRadius * Math.cos(angle);
        const startY = centerY + baseRadius * Math.sin(angle);
        
        // Calculate end point
        const endX = centerX + (baseRadius + lineLength) * Math.cos(angle);
        const endY = centerY + (baseRadius + lineLength) * Math.sin(angle);

        // Draw line
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Occasionally update random factors
        if (Math.random() < 0.02) { // 2% chance each frame
          randomFactors[i] = Math.random() * 0.5 + 0.5;
        }
      }

      requestAnimationFrame(draw);
    }

    const animation = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animation);
      source.disconnect();
      analyser.disconnect();
      audioContext.close();
    };
  }, [mediaStream, hasAudioTrack]);

  // Draw a static circle when no audio is available
  useEffect(() => {
    if (!hasAudioTrack && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;
      const centerX = WIDTH / 2;
      const centerY = HEIGHT / 2;
      const radius = Math.min(WIDTH, HEIGHT) * 0.3;

      // Clear canvas
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      
      // Draw gradient background circle
      const gradient = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius * 1.5
      );
      gradient.addColorStop(0, '#60A5FA'); // Lighter blue
      gradient.addColorStop(1, '#3B82F6'); // Darker blue
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fill();
      
      // Add GOT text for debugging/placeholder
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GOT', centerX, centerY);
    }
  }, [hasAudioTrack, canvasDimensions]);

  return (
    <div 
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        aspectRatio: '1/1',
        maxWidth: '400px',
        maxHeight: '400px',
      }}
    >
      <canvas 
        ref={canvasRef}
        width={canvasDimensions.width}
        height={canvasDimensions.height}
        style={{
          width: `${canvasDimensions.width}px`,
          height: `${canvasDimensions.height}px`,
          backgroundColor: 'transparent'
        }}
      />
    </div>
  );
}

export default AudioVisualizer;
