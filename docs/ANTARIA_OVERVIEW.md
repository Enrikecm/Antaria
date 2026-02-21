# Antaria: La Tanda del Futuro

## ¿Qué es Antaria?

**Antaria** es una plataforma fintech que digitaliza y asegura las **tandas** (ROSCA) a través de WhatsApp, combinando la tradición de ahorro comunitario latinoamericano con tecnología moderna de gestión de riesgo.

> *"La tanda de tu abuela, pero con la seguridad del siglo XXI."*

---

## El Problema que Resuelve

Las tandas mueven **billones de dólares** informalmente en LATAM, pero tienen problemas críticos:

| Problema | Impacto |
|----------|---------|
| **Alguien no paga** | La tanda colapsa |
| **Sin registros** | "Yo ya pagué" sin pruebas |
| **Depende del organizador** | Fraude o mala gestión |
| **Sin incentivos** | Cumplir a tiempo no tiene beneficio |

---

## Los 10 Módulos

### Módulos Core (Ciclo de Vida)

| # | Módulo | Función |
|---|--------|---------|
| **3** | Depósito Inicial | Cuota inicial → Fondo de Seguridad → Activación |
| **4** | Pagos Periódicos | Cuotas semanales/quincenales + validación |
| **6** | Panel de Estado | Vista rol-based (participante vs organizador) |
| **8** | Cierre + Rifa | Rendimientos del fondo + ganador auditable |

### Módulos de Protección (Fondo de Seguridad)

| # | Módulo | Función |
|---|--------|---------|
| **5** | Atrasos + Cobertura | 3 días gracia → cobertura automática |
| **5.1** | Reemplazo | Default → nuevo participante hereda posición |
| **5.2** | Recuperación | Post-turno: notas y seguimiento |
| **9** | Capas del Fondo | 4 capas (25/30/35/10%) con yield diferenciado |

### Módulos de UX

| # | Módulo | Función |
|---|--------|---------|
| **7** | Ledger Query | Historial inmutable, auditable, paginado |
| **10** | Recordatorios | E1/E2/E3/E4 anti-spam |

---

## ¿Qué la Hace Innovadora?

### 1. Fondo de Seguridad con Capas
```
Capa 1 (25%) → Muy líquida, cubre primero
Capa 2 (30%) → Semi-líquida
Capa 3 (35%) → Genera 3% rendimiento
Capa 4 (10%) → Genera 8% rendimiento
```

### 2. La Tanda Nunca Se Detiene
- Cobertura automática
- 3 días para regularizarse
- Reemplazo si no paga

### 3. Rifa de Rendimientos
Participantes al 100% → rifa del yield neto

### 4. WhatsApp como Interfaz
Sin apps. Sin wallets. Escribe "PAGAR" y listo.

### 5. Ledger Inmutable
Cada movimiento con timestamp. Auditable.

---

## Potencial

| Dimensión | Evaluación |
|-----------|------------|
| **Mercado** | ~$500B anuales en ROSCA global |
| **Adopción** | WhatsApp 95%+ en México |
| **Monetización** | Fee, spread, yield |
| **Expansión** | India, África, SE Asia |

---

## Escalabilidad

| Aspecto | Diseño |
|---------|--------|
| **Arquitectura** | Event Sourcing |
| **Base de datos** | SQLite → PostgreSQL |
| **Blockchain** | Híbrido, listo para Celo |
| **Multi-tenancy** | Tandas independientes |

---

## Principios de Diseño

1. **Separación de Concerns** - domain/infra/app
2. **Event Sourcing** - Estado derivado de eventos
3. **Módulos Independientes** - Tests aislados
4. **Idempotencia** - Sin duplicados
5. **Preparado para Blockchain** - Capas → Smart Contracts

---

## Resumen Ejecutivo

> **Antaria transforma la tanda informal en un producto financiero robusto.**
>
> Protección automática contra incumplimientos, rendimientos para quienes cumplen, interfaz WhatsApp accesible.
>
> Arquitectura modular y basada en eventos permite crecer de MVP a enterprise.
