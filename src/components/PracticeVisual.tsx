import type { ChartNote, DrumLane, MelodicInstrument, PitchNote, VisualInstrument, VisualMode } from '../types/chart'
import { STEM_LABELS } from '../types/chart'
import { FretboardView } from './FretboardView'
import { KitView } from './KitView'
import { NotationView } from './NotationView'
import { NoteHighway } from './NoteHighway'
import { PianoKit } from './PianoKit'
import { PitchHighway } from './PitchHighway'
import { PitchNotation } from './PitchNotation'

type Props = {
  mode: VisualMode
  instrument: VisualInstrument
  notes: ChartNote[]
  pitchNotes: PitchNote[] | null
  currentTime: number
  hitFlash: Partial<Record<DrumLane, number>>
}

export function PracticeVisual({ mode, instrument, notes, pitchNotes, currentTime, hitFlash }: Props) {
  if (instrument !== 'drums' && pitchNotes == null) {
    const name = STEM_LABELS[instrument]
    return (
      <div className="highway visual-empty">
        <div>
          <strong>{name}</strong>
          <p>Split stems, then click {name} in the mix to chart it.</p>
        </div>
      </div>
    )
  }

  if (instrument === 'drums') {
    if (mode === 'kit') return <KitView notes={notes} currentTime={currentTime} hitFlash={hitFlash} />
    if (mode === 'notation') return <NotationView notes={notes} currentTime={currentTime} hitFlash={hitFlash} />
    return <NoteHighway notes={notes} currentTime={currentTime} hitFlash={hitFlash} />
  }

  const melodic = instrument as MelodicInstrument
  const pitched = pitchNotes ?? []
  if (mode === 'kit') {
    if (melodic === 'piano') return <PianoKit notes={pitched} currentTime={currentTime} />
    return <FretboardView instrument={melodic} notes={pitched} currentTime={currentTime} />
  }
  if (mode === 'notation') return <PitchNotation instrument={melodic} notes={pitched} currentTime={currentTime} />
  return <PitchHighway instrument={melodic} notes={pitched} currentTime={currentTime} />
}
