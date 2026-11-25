/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import emblem from '../assets/navintellect-emblem.svg'
import './BrandMark.css'

/**
 * Logo badge at the top of the rail (and of the floating controls when the rail is collapsed):
 * the emblem on a lit tile, circled by a slow radar sweep.
 */
function BrandMark({ theme = 'light' }) {
  return (
    <div className={`brand-mark ${theme}`} tabIndex={0} aria-label="NavIntellect, Coastal Surveillance System">
      <span className="brand-sweep" aria-hidden="true" />
      <span className="brand-tile">
        <img src={emblem} alt="" draggable="false" />
      </span>
      <span className="brand-tip" role="tooltip">
        <strong>
          Nav<span>Intellect</span>
        </strong>
        <small>Coastal Surveillance System</small>
      </span>
    </div>
  )
}

export default BrandMark
