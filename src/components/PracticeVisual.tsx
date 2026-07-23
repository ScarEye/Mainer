import type { ChartNote, DrumLane, VisualMode } from '../types/chart'
import { KitView } from './KitView'
import { NotationView } from './NotationView'
import { NoteHighway } from './NoteHighway'

type Props = {
  mode: VisualMode
  notes: ChartNote[]
  currentTime: number
  hitFlash: Partial<Record<DrumLane, number>>
}

export function PracticeVisual({ mode, notes, currentTime, hitFlash }: Props) {
  if (mode === 'kit') {
    return <KitView notes={notes} currentTime={currentTime} hitFlash={hitFlash} />
  }
  if (mode === 'notation') {
    return <NotationView notes={notes} currentTime={currentTime} hitFlash={hitFlash} />
  }
  return <NoteHighway notes={notes} currentTime={currentTime} hitFlash={hitFlash} />
}
