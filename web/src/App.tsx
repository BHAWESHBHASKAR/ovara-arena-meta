import { useEffect, useState } from 'react'
import type { ArenaData } from './types'
import { loadReplay } from './data'
import { useRoute } from './router'
import Landing from './Landing'
import ArenaApp from './ArenaApp'

export default function App() {
  const route = useRoute()
  const [replay, setReplay] = useState<ArenaData | null>(null)
  useEffect(() => { loadReplay().then(setReplay) }, [])
  useEffect(() => {
    document.title = route.page === 'arena' ? 'Rounds · OVARA Arena' : 'OVARA Arena'
  }, [route.page])
  if (route.page === 'arena') return <ArenaApp route={route} replay={replay} />
  // #/tour opens the guided demo on the landing page
  return <Landing key="landing" data={replay} anchor={route.page === 'tour' ? 'try' : route.anchor} />
}
