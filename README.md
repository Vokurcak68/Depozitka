# Depozitka Core (separate service)

Samostatný projekt pro Depozitku (escrow engine), nezávislý na marketplace.

Obsah:
- API simulace create transaction
- Admin panel pro všechny escrow stavy
- Přechody stavů s validací
- Email logy (sandbox)
- Audit event timeline

Marketplace (`depozitka-test-bazar`) je oddělený klient a jen volá Depozitku přes konektor.
