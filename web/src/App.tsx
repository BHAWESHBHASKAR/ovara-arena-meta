import { useEffect, useState } from 'react'
import type { ArenaData } from './types'
import { loadReplay } from './data'
import { useRoute } from './router'
import Landing, { AboutPage, HowPage, ResultsPage } from './Landing'
import ArenaApp from './ArenaApp'

const TITLES: Record<string, string> = { landing: 'OVARA Arena', how: 'How it works · OVARA Arena', results: 'Results · OVARA Arena', about: 'About · OVARA Arena', arena: 'Rounds · OVARA Arena' }

export default function App() {
  const route = useRoute()
  const [replay, setReplay] = useState<ArenaData | null>(null)
  useEffect(() => { loadReplay().then(setReplay) }, [])
  useEffect(() => {
    document.title = TITLES[route.page] || 'OVARA Arena'
    if (route.page !== 'landing') window.scrollTo(0, 0)
  }, [route.page])
  switch (route.page) {
    case 'arena': return <ArenaApp route={route} replay={replay} />
    case 'how': return <HowPage />
    case 'results': return <ResultsPage data={replay} />
    case 'about': return <AboutPage />
    default: return <Landing data={replay} anchor={route.anchor} play={route.play} />
  }
}
