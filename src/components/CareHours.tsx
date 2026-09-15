import { MONTH_LIMIT_MIN, formatHM, monthHours } from '../lib/careHours'
import type { CareLog } from '../lib/types'

/** 남은 시간이 이보다 적으면 주의 색으로 보여준다 */
const NEAR_MIN = 10 * 60

/** 이 달 돌봄 시간 — 월 90시간까지 남은 시간을 크게 보여준다 (넘으면 초과 시간) */
export default function CareHours({ month, logs }: { month: number; logs: CareLog[] }) {
  const h = monthHours(logs)
  const percent = Math.min(100, (h.minutes / MONTH_LIMIT_MIN) * 100)
  const tone = h.over > 0 ? 'over' : h.remaining <= NEAR_MIN ? 'near' : 'ok'

  return (
    <section className={`care-hours ${tone}`} aria-label={`${month}월 돌봄 시간`}>
      <div className="ch-main">
        <span className="ch-label">{month}월 돌봄 · 90시간까지</span>
        <strong className="ch-big" aria-live="polite">
          {h.over > 0 ? `${formatHM(h.over)} 초과` : `${formatHM(h.remaining)} 남음`}
        </strong>
      </div>

      <div
        className="ch-bar"
        role="progressbar"
        aria-label="90시간 중 이번 달 돌봄 시간"
        aria-valuemin={0}
        aria-valuemax={90}
        aria-valuenow={Math.round((h.minutes / 60) * 10) / 10}
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="ch-meta">
        <span>이번 달 <b>{formatHM(h.minutes)}</b> / 90시간</span>
        {h.over > 0 && <span className="ch-warn">90시간을 넘은 {formatHM(h.over)}은 추가 급여가 없습니다</span>}
        {h.untimed > 0 && <span className="ch-note">시작 · 끝 시간이 없는 일지 {h.untimed}건은 합계에서 빠집니다</span>}
      </div>
    </section>
  )
}
