export function LandingSection({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <section className="landing panel">
      <div className="landingHero">
        <div>
          <h2>Escrow, které je srozumitelné i pro běžné uživatele</h2>
          <p>
            Depozitka oddělí peníze od marketplace, vede jasný průběh transakce a chrání kupujícího i prodávajícího.
          </p>
          <div className="landingActions">
            <button className="btn btnPrimary" onClick={onLoginClick}>
              Vstoupit do adminu
            </button>
            <a className="btn btnSecondary linkButton" href="#">
              Dokumentace API (coming soon)
            </a>
          </div>
        </div>
        <div className="landingCard">
          <h3>Flow v kostce</h3>
          <ol>
            <li>Marketplace založí transakci</li>
            <li>Kupující zaplatí do úschovy</li>
            <li>Prodávající odešle zásilku</li>
            <li>Po potvrzení doručení jde výplata prodejci</li>
          </ol>
        </div>
      </div>

      <div className="landingFeatures">
        <article>
          <h3>🔌 Integrace pro marketplace</h3>
          <p>Jednotný escrow engine pro více tržišť, pilotně napojený Test Bazar.</p>
        </article>
        <article>
          <h3>🧾 Audit a dohledatelnost</h3>
          <p>Každá změna stavu i notifikace mají stopu pro interní i právní potřeby.</p>
        </article>
        <article>
          <h3>⚖️ Sporové řízení</h3>
          <p>Spory, hold a refund workflow jsou řízené a vynucují odůvodnění kritických kroků.</p>
        </article>
      </div>
    </section>
  )
}

export function EmptyGroup({ text }: { text: string }) {
  return <p className="emptyGroup">{text}</p>
}
