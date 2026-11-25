import { useState, useEffect } from 'react';
import { useMap } from 'react-leaflet';
import './BottomBar.css';

function BottomBar() {
  const [mouseCoords, setMouseCoords] = useState({ lat: 0, lng: 0 });
  const [currentTime, setCurrentTime] = useState({
    ist: '',
    local: '',
  });
  const map = useMap();

  // Update time every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      
      // ist Time
      const istString = now.toLocaleString('en-US', {
        timeZone: 'IST',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      setCurrentTime({
        ist: `${istString} IST`,
      });
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Track mouse coordinates
  useEffect(() => {
    const onMouseMove = (e) => {
      const { lat, lng } = e.latlng;
      setMouseCoords({
        lat: lat.toFixed(4),
        lng: lng.toFixed(4)
      });
    };

    map.on('mousemove', onMouseMove);
    return () => map.off('mousemove', onMouseMove);
  }, [map]);

  return (
    <div className="bottom-bar">
      <div className="bottom-bar-section">
        <span className="time-display ist">{currentTime.ist}</span>
      </div>
      <div className="bottom-bar-section coordinates">
        <span>Lat: {mouseCoords.lat}° Lon: {mouseCoords.lng}°</span>

      </div>
    </div>
  );
}

export default BottomBar; 