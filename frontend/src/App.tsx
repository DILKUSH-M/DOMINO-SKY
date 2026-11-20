import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import {
  Activity, MapPin, BarChart3, Bell, ChevronDown, CircleUserRound, Clock3,
  Database, Gauge, Globe2, LayoutDashboard, Menu, Plane, Radio,
  Search, Settings, ShieldAlert, Sparkles, Users, X,
} from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Flight = {
  flight_id: string; tail_id: string; origin: string; destination: string;
  dep: string; arr: string; actual_dep: string; actual_arr: string;
  scheduled_dep: string; scheduled_arr: string; delay_minutes: number;
  arrival_delay_minutes: number; pax: number; status: string; delay_reasons: string[];
  propagation_chain: string[];
}
type AirportData = { id: string; name: string; city: string; lat: number; lng: number }
type Counts = {
  total_airports: number; total_flights: number; available_aircraft: number;
  delayed: number; cancelled: number; on_time: number; affected_passengers: number;
  stranded_passengers: number; crew_violations: number; total_network_delay: number;
}
type Simulation = {
  run_id: string; disruption: { airport: string; airport_name: string; duration: number; start: string; end: string; type: string };
  flights: Flight[]; counts: Counts; airport_impact: Array<{ airport: string; name: string; delayed_flights: number; total_delay_minutes: number; severity: string }>;
  missed_connections: Array<{ connection_id: string; airport: string; passengers: number; from_flight: string; to_flight: string }>;
  at_risk_connections: Array<unknown>; crew_violations: Array<{ crew_id: string; duty_duration: number; max_duty_mins: number }>;
  spare_aircraft: Array<{ tail_id: string; base: string; available_from: string }>;
}

const navItems = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Live Simulation', icon: Radio },
  { label: 'Flight Operations', icon: Plane },
  { label: 'Network Explorer', icon: Globe2 },
  { label: 'Passenger Impact', icon: Users },
  { label: 'Crew Operations', icon: CircleUserRound },
  { label: 'AI Dispatcher', icon: Sparkles },
  { label: 'Recovery Analysis', icon: BarChart3 },
  { label: 'Dataset Manager', icon: Database },
  { label: 'Settings', icon: Settings },
]

function formatDuration(minutes: number) {
  if (!minutes) return '0m'
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

function App() {
  const [active, setActive] = useState('Overview')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [airports, setAirports] = useState<AirportData[]>([])
  const [datasetFlights, setDatasetFlights] = useState<Array<{ flight_id: string; origin: string; destination: string }>>([])
  const [selectedAirport, setSelectedAirport] = useState('BOM')
  const [duration, setDuration] = useState(90)
  const [start, setStart] = useState('08:00')
  const [disruption, setDisruption] = useState('Thunderstorm')
  const [simulation, setSimulation] = useState<Simulation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recommendations, setRecommendations] = useState<Array<{ id: string; title: string; priority: string; explanation: string; action: Record<string, string> }>>([])
  const [applied, setApplied] = useState(false)
  const [recovered, setRecovered] = useState<Simulation | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [datasetLabel, setDatasetLabel] = useState('Sample dataset')

  useEffect(() => {
    Promise.all([
      fetch('/api/airports').then((response) => {
        if (!response.ok) throw new Error('Unable to load airports')
        return response.json()
      }),
      fetch('/api/flights').then((response) => response.json()),
      fetch('/api/dashboard').then((response) => {
        if (!response.ok) throw new Error('Unable to load dashboard')
        return response.json()
      }),
    ]).then(([airportData, flightData, dashboard]) => {
      setAirports(airportData)
      setDatasetFlights(flightData)
      setSimulation(dashboard.baseline)
      fetch('/api/datasets/status').then((response) => response.json()).then((status) => setDatasetLabel(status.label)).catch(() => undefined)
    }).catch((reason: Error) => setError(reason.message))
  }, [])

  const runSimulation = async () => {
    setLoading(true)
    setError('')
    setApplied(false)
    setRecovered(null)
    try {
      const response = await fetch('/api/simulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ airport: selectedAirport, duration, start, disruption }),
      })
      if (!response.ok) throw new Error((await response.json()).detail || 'Simulation failed')
      setSimulation(await response.json())
      setActive('Overview')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Simulation failed')
    } finally {
      setLoading(false)
    }
  }

  const loadRecommendations = async () => {
    if (!simulation) return
    const response = await fetch('/api/dispatcher/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: simulation.run_id }),
    })
    if (response.ok) {
      const data = await response.json()
      setRecommendations(data.recommendations)
    }
  }

  const applyRecommendation = async (action: Record<string, string>) => {
    if (!simulation) return
    setError('')
    try {
      const response = await fetch(`/api/recoveries/${simulation.run_id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      })
      if (!response.ok) throw new Error((await response.json()).detail || 'Recovery action failed')
      const data = await response.json()
      if (data.status === 'applied') {
        setRecovered(data.recovered)
        setApplied(true)
      } else {
        setError(data.reason || 'The recovery action produced no network improvement.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recovery action failed')
    }
  }

  const counts = simulation?.counts
  const chartData = useMemo(() => simulation?.airport_impact
    .filter((item) => item.delayed_flights > 0)
    .sort((a, b) => b.delayed_flights - a.delayed_flights)
    .slice(0, 8)
    .map((item) => ({ airport: item.airport, delayed: item.delayed_flights, delay: item.total_delay_minutes })) ?? [], [simulation])

  return (
    <div className="app-shell">
      <aside className={sidebarOpen ? 'sidebar' : 'sidebar collapsed'}>
        <div className="brand">
          <div className="brand-mark"><Plane size={18} /></div>
          {sidebarOpen && <div><strong>DOMINO</strong><span>SKY</span></div>}
        </div>
        <nav>
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => setActive(label)} title={label}>
              <Icon size={18} /><span>{sidebarOpen ? label : ''}</span>
            </button>
          ))}
        </nav>
        {sidebarOpen && simulation && (
          <div className="system-status">
            <div><span className="status-dot" /> Simulation status</div>
            <strong>{counts?.delayed ? 'Disruption active' : 'Network normal'}</strong>
          </div>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Toggle navigation"><Menu size={18} /></button>
          <div className="breadcrumb"><span>Operations</span><b>/</b><strong>{active}</strong></div>
          <div className="topbar-actions">
            <div className="dataset-pill"><span className="status-dot" /> {datasetLabel}</div>
            <div className="topbar-menu">
              <button className="icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={17} /></button>
              {notificationsOpen && <div className="popover"><strong>Notifications</strong><p>{simulation?.counts.delayed ? `${simulation.counts.delayed} flights affected by the active scenario.` : 'No active disruption.'}</p></div>}
            </div>
            <div className="topbar-menu">
              <button className="avatar" aria-label="User menu" onClick={() => setProfileOpen((value) => !value)}>AV</button>
              {profileOpen && <div className="popover profile"><strong>Operations Analyst</strong><p>Demonstration session</p></div>}
            </div>
          </div>
        </header>

        {error && <div className="error-banner"><ShieldAlert size={16} /> {error}<button onClick={() => setError('')}><X size={14} /></button></div>}

        <div className="content">
          {active === 'Overview' && <OverviewPage
            airports={airports}
            flights={datasetFlights}
            simulation={simulation}
            chartData={chartData}
            selectedAirport={selectedAirport}
            setSelectedAirport={setSelectedAirport}
            duration={duration}
            setDuration={setDuration}
            start={start}
            setStart={setStart}
            disruption={disruption}
            setDisruption={setDisruption}
            onRun={runSimulation}
            loading={loading}
            activeSection={active}
          />}
          {active === 'Live Simulation' && <LivePage airports={airports} flights={datasetFlights} simulation={simulation} />}
          {active === 'Flight Operations' && <FlightsPage simulation={simulation} />}
          {active === 'Network Explorer' && <NetworkPage airports={airports} flights={datasetFlights} simulation={simulation} />}
          {active === 'Passenger Impact' && <PassengerPage simulation={simulation} />}
          {active === 'Crew Operations' && <CrewPage simulation={simulation} />}
          {active === 'AI Dispatcher' && <DispatcherPage simulation={simulation} recommendations={recommendations} loadRecommendations={loadRecommendations} applied={applied} onApply={applyRecommendation} />}
          {active === 'Recovery Analysis' && <RecoveryPage simulation={simulation} recovered={recovered} applied={applied} />}
          {active === 'Dataset Manager' && <DatasetPage />}
          {active === 'Settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><div><span>{eyebrow}</span><h1>{title}</h1></div><p>{description}</p></div>
}

function OverviewPage(props: {
  airports: AirportData[]; flights: Array<{ flight_id: string; origin: string; destination: string }>; simulation: Simulation | null;
  chartData: Array<{ airport: string; delayed: number; delay: number }>; selectedAirport: string;
  setSelectedAirport: (value: string) => void; duration: number; setDuration: (value: number) => void;
  start: string; setStart: (value: string) => void; disruption: string; setDisruption: (value: string) => void;
  onRun: () => void; loading: boolean; activeSection: string;
}) {
  const counts = props.simulation?.counts
  const kpis: Array<[string, number, ComponentType<{ size?: number }>, string]> = [
    ['Total airports', counts?.total_airports ?? props.airports.length, MapPin, 'cyan'],
    ['Scheduled flights', counts?.total_flights ?? props.flights.length, Plane, 'blue'],
    ['Available aircraft', counts?.available_aircraft ?? 16, Gauge, 'green'],
    ['Delayed flights', counts?.delayed ?? 0, Clock3, 'amber'],
    ['Cancelled flights', counts?.cancelled ?? 0, X, 'red'],
    ['On-time flights', counts?.on_time ?? 0, Activity, 'green'],
  ]
  return (
    <>
      <PageHeading eyebrow="NETWORK OPERATIONS" title="Operational overview" description="Disruption impact across the airline network" />
      <section className="simulator-panel">
        <div className="simulator-heading"><div><span className="panel-kicker"><Radio size={13} /> Airport disruption simulator</span><h2>Configure scenario</h2></div><div className="live-chip"><span /> Deterministic engine ready</div></div>
        <div className="simulator-controls">
          <label>Airport
            <div className="select-wrap"><Search size={15} /><select value={props.selectedAirport} onChange={(event) => props.setSelectedAirport(event.target.value)}>
              {props.airports.map((airport) => <option value={airport.id} key={airport.id}>{airport.id} — {airport.city}</option>)}
            </select><ChevronDown size={14} /></div>
          </label>
          <label>Disruption type<select value={props.disruption} onChange={(event) => props.setDisruption(event.target.value)}>
            <option>Thunderstorm</option><option>Heavy rain</option><option>Fog</option><option>Runway closure</option><option>Airport operational restriction</option>
          </select></label>
          <label>Start time<input type="time" value={props.start} onChange={(event) => props.setStart(event.target.value)} /></label>
          <label>Closure duration<select value={props.duration} onChange={(event) => props.setDuration(Number(event.target.value))}>
            {[30, 60, 90, 120, 180, 240].map((value) => <option value={value} key={value}>{value} minutes</option>)}
          </select></label>
          <button className="primary-button" onClick={props.onRun} disabled={props.loading}>
            <Radio size={16} /> {props.loading ? 'Simulating…' : 'Run simulation'}
          </button>
        </div>
      </section>
      {props.simulation && <div className="scenario-strip"><div><span>Active scenario</span><strong>{props.simulation.disruption.airport_name}</strong></div><div><span>Disruption</span><strong>{props.simulation.disruption.type}</strong></div><div><span>Closure</span><strong>{props.simulation.disruption.start} — {props.simulation.disruption.end}</strong></div><div><span>Run ID</span><strong>DS-{props.simulation.run_id.toUpperCase()}</strong></div></div>}
      <section className="kpi-grid">{kpis.map(([label, value, Icon, tone]) => <div className="kpi-card" key={label as string}><div className={`kpi-icon ${tone}`}><Icon size={18} /></div><div><span>{label}</span><strong>{value as number}</strong></div></div>)}</section>
      <section className="dashboard-grid">
        <div className="panel chart-panel"><div className="panel-heading"><div><span>DOWNSTREAM IMPACT</span><h3>Airport disruption severity</h3></div></div>
          <div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={props.chartData} layout="vertical" margin={{ left: 8, right: 16 }}><XAxis type="number" hide /><YAxis type="category" dataKey="airport" axisLine={false} tickLine={false} tick={{ fill: '#8191a7', fontSize: 12 }} width={44} /><Tooltip cursor={{ fill: 'rgba(255,255,255,.025)' }} contentStyle={{ background: '#101c2c', border: '1px solid #26354a', borderRadius: 8 }} /><Bar dataKey="delayed" fill="#3aa9c5" radius={[0, 4, 4, 0]} barSize={12} /></BarChart></ResponsiveContainer></div>
        </div>
        <div className="panel impact-panel"><div className="panel-heading"><div><span>PASSENGER & CREW</span><h3>Operational impact</h3></div></div>
          <div className="impact-kpis"><div><Users size={17} /><span>Affected passengers</span><strong>{counts?.affected_passengers ?? 0}</strong></div><div><ShieldAlert size={17} /><span>Stranded passengers</span><strong>{counts?.stranded_passengers ?? 0}</strong></div><div><CircleUserRound size={17} /><span>Crew duty violations</span><strong>{counts?.crew_violations ?? 0}</strong></div></div>
          <div className="network-health"><div><span>Network health</span><strong>{counts?.delayed ? 'Degraded' : 'Healthy'}</strong></div><div className="health-track"><i style={{ width: counts?.delayed ? '68%' : '94%' }} /></div></div>
        </div>
      </section>
    </>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'Delayed' ? 'amber' : status === 'Cancelled' ? 'red' : 'green'
  return <span className={`badge ${tone}`}><i />{status}</span>
}

function FlightsPage({ simulation }: { simulation: Simulation | null }) {
  const [query, setQuery] = useState('')
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null)
  const flights = (simulation?.flights ?? []).filter((flight) => flight.flight_id.toLowerCase().includes(query.toLowerCase()))
  return <><PageHeading eyebrow="OPERATIONS" title="Flight operations" description="Calculated schedule with propagation impact" /><section className="panel table-panel"><div className="table-toolbar"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search flight ID" /></label><span>{flights.length} flights</span></div><div className="table-wrap"><table><thead><tr><th>Flight</th><th>Route</th><th>Departure</th><th>Arrival</th><th>Aircraft</th><th>Delay</th><th>Status</th></tr></thead><tbody>{flights.map((flight) => <tr key={flight.flight_id} onClick={() => setSelectedFlight(flight)} className="clickable-row"><td><strong>{flight.flight_id}</strong></td><td>{flight.origin}<span className="route-arrow">→</span>{flight.destination}</td><td>{flight.actual_dep}<small>{flight.scheduled_dep}</small></td><td>{flight.actual_arr}<small>{flight.scheduled_arr}</small></td><td>{flight.tail_id}</td><td>{flight.delay_minutes ? `+${flight.delay_minutes}m` : '—'}</td><td><StatusBadge status={flight.status} /></td></tr>)}</tbody></table></div></section>{selectedFlight && <div className="flight-drawer"><button className="drawer-close" onClick={() => setSelectedFlight(null)} aria-label="Close flight details"><X size={16} /></button><span>FLIGHT DETAIL</span><h3>{selectedFlight.flight_id}</h3><dl><div><dt>Aircraft</dt><dd>{selectedFlight.tail_id}</dd></div><div><dt>Route</dt><dd>{selectedFlight.origin} → {selectedFlight.destination}</dd></div><div><dt>Passengers</dt><dd>{selectedFlight.pax}</dd></div><div><dt>Departure</dt><dd>{selectedFlight.scheduled_dep} → {selectedFlight.actual_dep}</dd></div><div><dt>Arrival</dt><dd>{selectedFlight.scheduled_arr} → {selectedFlight.actual_arr}</dd></div><div><dt>Calculated delay</dt><dd>{selectedFlight.delay_minutes} minutes</dd></div></dl><p>{selectedFlight.delay_reasons.length ? selectedFlight.delay_reasons.join('. ') : 'No disruption delay calculated.'}</p></div>}</>
}

function LivePage({ airports, flights, simulation }: { airports: AirportData[]; flights: Array<{ flight_id: string; origin: string; destination: string }>; simulation: Simulation | null }) {
  const [timeline, setTimeline] = useState(72)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setTimeline((value) => {
        if (value >= 100) {
          setPlaying(false)
          return 100
        }
        return value + 4
      })
    }, 150)
    return () => window.clearInterval(timer)
  }, [playing])
  return <>
    <PageHeading eyebrow="SIMULATION" title="Domino effect" description="Visual disruption propagation across the aircraft network" />
    <section className="live-layout">
      <div className="panel network-map"><div className="map-grid" />
        <svg viewBox="0 0 720 430" role="img" aria-label="Indian airport network map">
          {flights.map((flight, index) => {
            const origin = airports.find((airport) => airport.id === flight.origin)
            const destination = airports.find((airport) => airport.id === flight.destination)
            if (!origin || !destination) return null
            const x1 = ((origin.lng - 68) / 26) * 620 + 50
            const y1 = 380 - ((origin.lat - 8) / 24) * 330
            const x2 = ((destination.lng - 68) / 26) * 620 + 50
            const y2 = 380 - ((destination.lat - 8) / 24) * 330
            const delayed = simulation?.flights.find((item) => item.flight_id === flight.flight_id)?.status === 'Delayed'
            return <line key={flight.flight_id} x1={x1} y1={y1} x2={x2} y2={y2} className={delayed ? 'route delayed' : index % 5 === 0 ? 'route minor' : 'route'} />
          })}
          {airports.map((airport) => {
            const x = ((airport.lng - 68) / 26) * 620 + 50
            const y = 380 - ((airport.lat - 8) / 24) * 330
            const disrupted = airport.id === simulation?.disruption.airport
            const impacted = simulation?.airport_impact.find((item) => item.airport === airport.id)?.delayed_flights
            return <g key={airport.id}><circle cx={x} cy={y} r={disrupted ? 10 : impacted ? 7 : 4} className={disrupted ? 'node disrupted' : impacted ? 'node impacted' : 'node'} /><text x={x + 10} y={y - 8} className="airport-label">{airport.id}</text></g>
          })}
        </svg>
        <div className="map-legend"><span><i className="legend-dot green" />Unaffected</span><span><i className="legend-dot amber" />Delayed</span><span><i className="legend-dot red" />Disruption</span></div>
      </div>
      <div className="panel timeline-panel"><div className="panel-heading"><div><span>PROPAGATION</span><h3>Simulation timeline</h3></div></div><div className="timeline"><div className="timeline-line"><i style={{ width: `${timeline}%` }} /></div>{['Closure', 'Departure delay', 'Late arrival', 'Turnaround', 'Connection impact'].map((item, index) => <div className={index * 25 <= timeline ? 'timeline-step complete' : 'timeline-step'} key={item}><span>{index + 1}</span><div><strong>{item}</strong><small>{index === 0 ? 'Initial disruption' : `Propagation stage ${index + 1}`}</small></div></div>)}</div></div>
    </section>
    <div className="playback"><button onClick={() => { setPlaying(false); setTimeline(0) }}>Reset</button><button className="play" onClick={() => { if (timeline >= 100) setTimeline(0); setPlaying((value) => !value) }}>{playing ? 'Pause' : 'Play'}</button><input type="range" min="0" max="100" value={timeline} onChange={(event) => { setPlaying(false); setTimeline(Number(event.target.value)) }} /><span>{timeline}%</span></div>
  </>
}

function NetworkPage({ airports, flights, simulation }: { airports: AirportData[]; flights: Array<{ flight_id: string; origin: string; destination: string }>; simulation: Simulation | null }) {
  const [selectedAirport, setSelectedAirport] = useState<string | null>(null)
  const selected = selectedAirport ? airports.find((airport) => airport.id === selectedAirport) : null
  const selectedImpact = selectedAirport ? simulation?.airport_impact.find((item) => item.airport === selectedAirport) : null
  return <><PageHeading eyebrow="NETWORK" title="Network explorer" description="Airport relationships and route impact" /><div className="network-cards">{airports.map((airport) => { const impact = simulation?.airport_impact.find((item) => item.airport === airport.id); return <button className={selectedAirport === airport.id ? 'network-card selected' : 'network-card'} key={airport.id} onClick={() => setSelectedAirport(airport.id)}><div><strong>{airport.id}</strong><span>{airport.city}</span></div><StatusBadge status={impact?.delayed_flights ? 'Delayed' : 'Unaffected'} /></button> })}</div>{selected && <div className="panel airport-detail"><button onClick={() => setSelectedAirport(null)} aria-label="Clear airport selection"><X size={14} /></button><strong>{selected.id} · {selected.name}</strong><span>{selectedImpact?.delayed_flights ?? 0} affected flights · {selectedImpact?.total_delay_minutes ?? 0} total delay minutes</span></div>}<div className="panel route-summary"><h3>Active routes</h3>{flights.slice(0, 12).map((flight) => <div key={flight.flight_id}><Plane size={15} /><strong>{flight.flight_id}</strong><span>{flight.origin} → {flight.destination}</span></div>)}</div></>
}

function PassengerPage({ simulation }: { simulation: Simulation | null }) {
  const counts = simulation?.counts
  return <><PageHeading eyebrow="PASSENGERS" title="Passenger impact" description="Unique affected and stranded passenger counts" /><section className="passenger-grid"><div className="metric-card"><span>Total on network</span><strong>{simulation?.flights.reduce((sum, flight) => sum + flight.pax, 0).toLocaleString() ?? '—'}</strong></div><div className="metric-card"><span>Affected passengers</span><strong>{counts?.affected_passengers ?? 0}</strong></div><div className="metric-card amber"><span>Missed connections</span><strong>{simulation?.missed_connections.length ?? 0}</strong></div><div className="metric-card red"><span>Stranded passengers</span><strong>{counts?.stranded_passengers ?? 0}</strong></div></section><section className="panel table-panel"><div className="panel-heading"><div><span>CONNECTIONS</span><h3>Missed passenger connections</h3></div></div><div className="table-wrap"><table><thead><tr><th>Connection</th><th>Airport</th><th>Flights</th><th>Passengers</th><th>Status</th></tr></thead><tbody>{simulation?.missed_connections.map((connection) => <tr key={connection.connection_id}><td>{connection.connection_id}</td><td>{connection.airport}</td><td>{connection.from_flight} → {connection.to_flight}</td><td>{connection.passengers}</td><td><StatusBadge status="Delayed" /></td></tr>)}</tbody></table></div></section></>
}

function CrewPage({ simulation }: { simulation: Simulation | null }) {
  return <><PageHeading eyebrow="CREW OPERATIONS" title="Duty constraints" description="Calculated crew availability and duty-limit conflicts" /><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Crew</th><th>Duty duration</th><th>Limit</th><th>Status</th></tr></thead><tbody>{simulation?.crew_violations.map((crew) => <tr key={crew.crew_id}><td><strong>{crew.crew_id}</strong></td><td>{formatDuration(crew.duty_duration)}</td><td>{formatDuration(crew.max_duty_mins)}</td><td><StatusBadge status="Delayed" /></td></tr>)}<tr><td colSpan={4} style={{ textAlign: 'center', color: '#8191a7' }}>{simulation?.crew_violations.length ? '' : 'No crew duty violations calculated for this run.'}</td></tr></tbody></table></div></section></>
}

function DispatcherPage({ simulation, recommendations, loadRecommendations, applied, onApply }: { simulation: Simulation | null; recommendations: Array<{ id: string; title: string; priority: string; explanation: string; action: Record<string, string> }>; loadRecommendations: () => void; applied: boolean; onApply: (action: Record<string, string>) => void }) {
  const [rejected, setRejected] = useState<string[]>([])
  return <><PageHeading eyebrow="AI OPERATIONS ASSISTANT" title="AI Dispatcher" description="Recommendations constrained by deterministic simulation results" /><section className="dispatcher-layout"><div className="panel dispatcher-chat"><div className="assistant"><div className="brand-mark small"><Sparkles size={15} /></div><div><strong>Domino Assistant</strong><p>{simulation ? `${simulation.disruption.airport_name} is the active disruption point. The engine calculated ${simulation.counts.delayed} delayed flights and ${simulation.counts.stranded_passengers} stranded passengers.` : 'Run a disruption simulation to begin.'}</p></div></div><button className="primary-button" onClick={loadRecommendations}><Sparkles size={16} />Generate recommendations</button></div><div className="recommendation-list">{recommendations.map((recommendation) => <article className="panel recommendation" key={recommendation.id}><div className="recommendation-top"><span className={recommendation.priority === 'High' ? 'priority high' : 'priority'}>{recommendation.priority} priority</span><strong>Calculated option</strong></div><h3>{recommendation.title}</h3><p>{recommendation.explanation}</p><div className="recommendation-actions"><button onClick={() => onApply(recommendation.action)} disabled={applied || rejected.includes(recommendation.id)}>{applied ? 'Applied' : rejected.includes(recommendation.id) ? 'Rejected' : 'Apply action'}</button><button onClick={() => setRejected((values) => [...values, recommendation.id])} disabled={applied || rejected.includes(recommendation.id)}>Reject</button></div></article>)}</div></section></>
}

function RecoveryPage({ simulation, recovered, applied }: { simulation: Simulation | null; recovered: Simulation | null; applied: boolean }) {
  const baseline = simulation?.counts.delayed ?? 0
  const recoveredDelay = recovered?.counts.delayed ?? baseline
  const recoveredNetworkDelay = recovered?.counts.total_network_delay ?? (simulation?.counts.total_network_delay ?? 0)
  const effectiveness = baseline ? Math.round(((baseline - recoveredDelay) / baseline) * 100) : 0
  return <><PageHeading eyebrow="RECOVERY" title="Before & after analysis" description="Compare the disruption baseline with the approved recovery plan" /><section className="recovery-kpis"><div className="metric-card"><span>Delayed flights</span><strong>{baseline}</strong><small>Before</small></div><div className="metric-card green"><span>Delayed flights</span><strong>{applied ? recoveredDelay : '—'}</strong><small>{applied ? 'After' : 'Awaiting approval'}</small></div><div className="metric-card"><span>Network delay</span><strong>{formatDuration(simulation?.counts.total_network_delay ?? 0)}</strong><small>Before</small></div><div className="metric-card green"><span>Network delay</span><strong>{formatDuration(recoveredNetworkDelay)}</strong><small>{applied ? `After · ${effectiveness}% flight reduction` : 'Awaiting approval'}</small></div></section><section className="panel recovery-tradeoff"><ShieldAlert size={18} /><div><strong>Recovery trade-off</strong><p>{applied ? 'The backend recalculated the full disruption result after approval.' : 'Apply an action in AI Dispatcher to recalculate the network.'}</p></div></section></>
}

function DatasetPage() {
  const [status, setStatus] = useState<{ mode: string; label: string; airports: number; flights: number; connections: number } | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    fetch('/api/datasets/status').then((response) => response.json()).then(setStatus).catch(() => setMessage('Unable to load dataset status'))
  }, [])
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setMessage('')
    const body = new FormData()
    body.append('file', file)
    const response = await fetch('/api/datasets/import', { method: 'POST', body })
    if (!response.ok) {
      const error = await response.json()
      setMessage(error.detail || 'Dataset import failed')
      return
    }
    const imported = await response.json()
    setStatus({ mode: 'official-upload', label: 'Official uploaded dataset', airports: imported.airports, flights: imported.flights, connections: imported.connections })
    setMessage('Dataset imported and validated successfully.')
  }
  return <><PageHeading eyebrow="DATA GOVERNANCE" title="Dataset manager" description="Inspect and validate operational datasets" /><section className="dataset-status panel"><div className="dataset-upload"><Database size={22} /><div><strong>{status?.label ?? 'Loading dataset status…'}</strong><p>{message || 'The supplied flight network is loaded for demonstration.'}</p></div><label className="upload-button">Upload JSON<input type="file" accept=".json,application/json" onChange={upload} /></label></div><div className="dataset-stats"><div><span>Airports</span><strong>{status?.airports ?? 16}</strong></div><div><span>Flights</span><strong>{status?.flights ?? 70}</strong></div><div><span>Aircraft</span><strong>16</strong></div><div><span>Connections</span><strong>{status?.connections ?? 21}</strong></div></div></section></>
}

function SettingsPage() {
  return <><PageHeading eyebrow="CONFIGURATION" title="Settings" description="Application and simulation preferences" /><section className="panel settings-panel"><label>Time zone<select><option>India Standard Time (IST)</option></select></label><label>Simulation mode<select><option>Deterministic</option></select></label><label>AI provider<select><option>Deterministic fallback</option></select></label></section></>
}

export default App
