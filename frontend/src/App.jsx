import MapComponent from './components/MapComponent'
import Sidebar from './components/Sidebar'
import BottomBar from './components/BottomBar'
import './App.css'
import { useSelector, useDispatch } from 'react-redux'
import { toggleTheme, toggleClustering } from './store/themeSlice'
import clusterIcon from './assets/Cluster.png'

function App() {
  const theme = useSelector((state) => state.theme.mode)
  const clustering = useSelector((state) => state.theme.clustering)
  const dispatch = useDispatch()

  return (
    <div className="app">

      <div className="control-buttons">
        <button 
          className={`cluster-toggle-btn ${theme} ${clustering ? 'active' : ''}`}
          onClick={() => dispatch(toggleClustering())}
          title={clustering ? 'Disable clustering' : 'Enable clustering'}
        >
          <img 
            src={clusterIcon} 
            alt="clustering"
            className="cluster-icon"
            height={20}
            width={20}
          />
        </button>
      </div>

      <MapComponent>
        <Sidebar />
        {/* <BottomBar /> */}
      </MapComponent>
    </div>
  )
}

export default App
