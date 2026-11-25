/* eslint-disable react/prop-types -- presentational components; the project does not use PropTypes */
import { formatDecimal, toDMS } from '../../../utils/coords'
import { pinSvg } from './pinStyle'

/** A pin rendered in the UI (same SVG as on the map). Markup comes from static constants. */
export function PinGlyph({ style, size = 22 }) {
  return (
    <span
      className="gf-pin-glyph"
      style={{ width: size, height: Math.round(size * 1.3) }}
      dangerouslySetInnerHTML={{ __html: pinSvg(style) }}
    />
  )
}

/** Both coordinate forms of a position. */
export function Coordinates({ latlng }) {
  return (
    <div className="gf-coords">
      <span>
        {toDMS(latlng.lat, true, 1)} &nbsp; {toDMS(latlng.lng, false, 1)}
      </span>
      <small>{formatDecimal(latlng)}</small>
    </div>
  )
}
