/* eslint-disable react/prop-types -- presentational component; the project does not use PropTypes */
import { ObjectRow } from './ObjectList'

/**
 * Tabbed lists of map objects. Each tab:
 *   { id, label, total, rows (ObjectRow props with `key` and `type`), empty: { text, actionLabel?, onAction? }, onSetAllHidden(hide) }
 * Within a tab that mixes types, chips filter by type (All · Polygons · Rectangles · Circles …).
 */
export function ObjectTabs({ tabs, active, onChange, filter, onFilter, typeFilter, onTypeFilter }) {
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]

  // Types present in this tab, in a stable order, with counts.
  const types = []
  for (const row of tab.rows) {
    const t = types.find((x) => x.type.id === row.type.id)
    if (t) t.count++
    else types.push({ type: row.type, count: 1 })
  }
  const activeType = types.some((t) => t.type.id === typeFilter) ? typeFilter : null
  const rows = activeType ? tab.rows.filter((r) => r.type.id === activeType) : tab.rows
  const allHidden = rows.length > 0 && rows.every((r) => r.hidden)

  return (
    <section className="gf-tabs-wrap">
      <div className="gf-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-guide={`objects.tab.${t.id}`}
            aria-selected={t.id === tab.id}
            className={t.id === tab.id ? 'on' : ''}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            <span className="gf-count">{t.total}</span>
          </button>
        ))}
      </div>

      <div className="gf-tab-tools">
        <input className="gf-search" placeholder={`Search ${tab.label.toLowerCase()}`} value={filter} onChange={(e) => onFilter(e.target.value)} aria-label={`Search ${tab.label}`} />
        {rows.length > 0 && (
          <button type="button" className="gf-link" onClick={() => tab.onSetAllHidden(!allHidden, rows)}>
            {allHidden ? 'Show all' : 'Hide all'}
          </button>
        )}
      </div>

      {types.length > 1 && (
        <div className="gf-type-filter" role="radiogroup" aria-label="Filter by type">
          <button type="button" role="radio" aria-checked={!activeType} className={!activeType ? 'on' : ''} onClick={() => onTypeFilter(null)}>
            All <span>{tab.rows.length}</span>
          </button>
          {types.map(({ type, count }) => (
            <button
              key={type.id}
              type="button"
              role="radio"
              aria-checked={activeType === type.id}
              className={`t-${type.id} ${activeType === type.id ? 'on' : ''}`}
              onClick={() => onTypeFilter(type.id)}
            >
              <type.Icon size={13} />
              {type.plural} <span>{count}</span>
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel" aria-label={tab.label}>
        {rows.length ? (
          <ul className="gf-list">
            {rows.map(({ key, ...row }) => (
              <ObjectRow key={key} {...row} />
            ))}
          </ul>
        ) : (
          <div className="gf-empty-state">
            <p>{filter ? `Nothing matches “${filter}”.` : tab.empty.text}</p>
            {!filter && tab.empty.actionLabel && (
              <button type="button" className="gf-btn primary" onClick={tab.empty.onAction}>
                {tab.empty.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
