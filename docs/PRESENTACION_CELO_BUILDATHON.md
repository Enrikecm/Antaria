# 🟢 Antaria — La Tanda del Futuro en Celo
### Celo Buildathon 2026

---

## Slide 1 — El Problema

### 8.3 millones de mexicanos ahorran en tandas informales

Las tandas (ROSCA) son el mecanismo de ahorro comunitario más popular en LATAM. Pero tienen problemas críticos:

| Problema | Impacto |
|----------|---------|
| **Alguien no paga** | La tanda colapsa, todos pierden |
| **Sin registros** | "Yo ya pagué" sin pruebas |
| **Depende del organizador** | Fraude o mala gestión sin rendición de cuentas |
| **Sin incentivos** | Cumplir a tiempo no tiene ningún beneficio extra |
| **Sin transparencia** | No hay forma de auditar los movimientos |

**Fuente:** Encuesta Nacional de Inclusión Financiera (ENIF)

| Dato | Cifra |
|------|-------|
| Personas 18+ en México | 92,806,711 |
| Ahorro informal | 41% |
| Ahorro informal en tandas | 22% |
| Personas que ahorran exclusivamente informal | 38,050,752 |
| **Población que ahorra en tandas** | **8,371,165** |

---

## Slide 2 — La Solución: Antaria

### Antaria transforma las tandas informales en una experiencia segura, transparente y rentable mediante blockchain

> *"La tanda de tu abuela, pero con la seguridad del siglo XXI."*

**¿Cómo funciona?**

1. 📱 **WhatsApp como interfaz** — Sin apps, sin wallets. Escribe "PAGAR" y listo
2. 🛡️ **Fondo de Garantía** — Cobertura automática si alguien no paga
3. ⭐ **Sistema de Reputación** — Tu historial de cumplimiento te abre puertas
4. 🌐 **Tandas Públicas y Privadas** — Entre conocidos o con personas de todo el país
5. 💰 **Fiat o Cripto** — Participa con pesos o criptomonedas
6. 🔗 **Anclaje On-Chain en Celo** — Cada evento queda registrado, inmutable y verificable

---

## Slide 3 — Innovación: Lo que Hace Diferente a Antaria

### 🛡️ Fondo de Garantía Inteligente (4 capas)
```
Capa 1 (25%) → Muy líquida, cubre faltas primero
Capa 2 (30%) → Semi-líquida
Capa 3 (35%) → Inversión
Capa 4 (10%) → Inversión
```

Un fondo con doble función:
- **Aportación Inicial**: Antes de iniciar la tanda, cada participante aporta una cantidad equivalente a su aportación periódica, formando el fondo colectivo.
- **Cobertura**: Cubre automáticamente a cualquier participante que se retrase, garantizando que la tanda nunca se detenga.
- **Rifa de Rendimientos**: El fondo genera rendimientos durante toda la tanda, y al finalizar, el rendimiento acumulado es rifado entre todos los participantes, premiando a un solo ganador entre quienes cumplieron con todas sus aportaciones.

### 🌐 Tandas Públicas y Privadas
- **Privadas**: Tandas tradicionales entre conocidos, ahora con seguridad blockchain
- **Públicas**: Si tienes buena reputación, accede a tandas con personas de todo el país o del extranjero

### ⭐ Sistema de Reputación
- Cada aportación puntual suma puntos
- Mayor reputación = acceso a tandas públicas, mejores montos, prioridad de turno

### 📱 100% vía WhatsApp
- WhatsApp 95%+ penetración en México
- Sin descargas, sin registros complicados
- Recordatorios automáticos de pago

---

## Slide 4 — Tamaño de Mercado

### México: $40B - $80B MXN anuales en tandas

| Escenario | Aportación mensual | Mercado anual (tandas en pesos) |
|-----------|-------------------:|-------------------------------:|
| 🟢 Conservador | $400 | $40,181,593,595 |
| 🟡 Moderado | $600 | $60,272,390,392 |
| 🔴 Optimista | $800 | $80,363,187,189 |

**Mercado global ROSCA: ~$500B USD anuales**

### Escalabilidad
| Dimensión | Potencial |
|-----------|-----------|
| **México** | 8.3M personas en tandas |
| **LATAM** | Colombia, Perú, Centroamérica |
| **Global** | India (chit funds), África (stokvel), SE Asia (arisan) |
| **Monetización** | Comisión por tanda, spread en rendimientos, yield en DeFi |

---

## Slide 5 — Arquitectura Técnica (Celo)

### Infraestructura de Antaria

```
┌───────────────────────────────────────────────┐
│              WhatsApp (Baileys)                │ ← Interfaz de usuario
├───────────────────────────────────────────────┤
│                  App Layer                     │
│   Message Handler  │  Scheduler (cron jobs)    │
├───────────────────────────────────────────────┤
│                Domain Layer                    │
│   Tanda Service  │  Events  │  Entities        │
├───────────────────────────────────────────────┤
│                 Infra Layer                    │
│  Database  │  Ledger  │  Session  │  Anchor    │
├───────────────────────────────────────────────┤
│                Celo Mainnet 🟢                 │
│   AnchorRegistry Smart Contract (Solidity)     │
│   Chain ID: 42220  │  EVM-compatible           │
└───────────────────────────────────────────────┘
```

### 10 Módulos del Sistema

| Categoría | Módulos |
|-----------|---------|
| **Core (Ciclo de Vida)** | Depósito Inicial, Pagos Periódicos, Panel de Estado, Cierre + Rifa |
| **Protección** | Atrasos + Cobertura, Reemplazo, Recuperación, Capas del Fondo |
| **UX** | Ledger Query (historial auditable), Recordatorios automáticos |

### Contrato Inteligente: AnchorRegistry

**Eventos que se anclan on-chain:**

| Evento | Trigger |
|--------|---------|
| `TANDA_CREATED` | Se crea una nueva tanda |
| `TANDA_ACTIVATED` | La tanda se llena y arranca |
| `INITIAL_FUND_COMPLETED` | El fondo de garantía está completo |
| `COVERAGE_ACTIVATED` | Se cubre una falta de pago automáticamente |
| `USER_REPLACED` | Un miembro incumplido es reemplazado |
| `TANDA_CLOSED` | La tanda termina exitosamente |
| `RAFFLE_RESULT` | Se elige al ganador de los rendimientos |

### ¿Por qué Celo?
- **EVM-compatible** → Contratos Solidity sin cambios
- **Mobile-first** → Diseñado para uso móvil, ideal para WhatsApp
- **Stablecoins nativas** → cUSD, cEUR para tandas en moneda estable
- **Bajo costo** → Gas fees mínimos para micro-transacciones
- **Impacto social** → Misión alineada con inclusión financiera

### Principios de diseño
- **Event Sourcing** — Estado derivado de eventos inmutables
- **Separación de Concerns** — domain / infra / app
- **Idempotencia** — Sin duplicados
- **Privacy-safe** — Solo hashes salados on-chain, sin datos personales

---

## Slide 6 — Demo y Verificación

### ✅ Lo que construimos para el Celo Buildathon

| Componente | Status | Detalle |
|------------|--------|---------|
| Contrato AnchorRegistry | ✅ Listo | Solidity 0.8.20, EVM-compatible |
| Bot WhatsApp | ✅ Funcional | Baileys + Anchor multi-red |
| Frontend Celo | ✅ Construido | Theme 🟢 con 4 tarjetas de innovación |
| Soporte Multi-Red | ✅ Implementado | Monad + Celo via env var |

### Roadmap

| Fase | Objetivo |
|------|----------|
| **Ahora** | Deploy contrato en Celo + Frontend público |
| **Q2 2026** | Beta con tandas reales (cUSD) |
| **Q3 2026** | Sistema de reputación on-chain |
| **Q4 2026** | Tandas públicas + DeFi yield |

---

### Contacto
**Antaria** — Tandas transparentes en Celo 🟢
Celo Buildathon 2026 | Construido con 💚 para LATAM

GitHub: [github.com/Enrikecm/Antaria](https://github.com/Enrikecm/Antaria)
