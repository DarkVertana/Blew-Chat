.DEFAULT_GOAL := help
.PHONY: help up down build reset logs ps psql api-sh web-sh test prod-up prod-down

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Start the dev stack (hot reload) in the foreground
	docker compose up --build

down: ## Stop the dev stack
	docker compose down

build: ## Rebuild images without starting
	docker compose build

reset: ## Stop and delete volumes (wipes the database)
	docker compose down -v

logs: ## Tail logs for all services
	docker compose logs -f

ps: ## Show service status
	docker compose ps

psql: ## Open a psql shell in the db container
	docker compose exec db psql -U $${POSTGRES_USER:-blew} -d $${POSTGRES_DB:-blew}

api-sh: ## Shell into the api container
	docker compose exec api sh

web-sh: ## Shell into the web container
	docker compose exec web sh

test: ## Run Go auth integration tests and web tests/lint/typecheck
	docker compose exec api sh -c 'TEST_DATABASE_URL="$$DATABASE_URL" go test ./...'
	docker compose exec web pnpm test
	docker compose exec web pnpm lint
	docker compose exec web pnpm exec tsc --noEmit

prod-up: ## Build and run production images (no dev override)
	docker compose -f compose.yaml up --build -d

prod-down: ## Stop the production stack
	docker compose -f compose.yaml down
