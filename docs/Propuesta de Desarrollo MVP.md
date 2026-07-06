# **Propuesta de Desarrollo: Automatización de Planos Eléctricos con IA**

**Cliente:** Cambre

**Proveedor:** Vanguard-IA

**Documento:** Alcance y Especificaciones del MVP

> **Nota de implementación (2026-07):** el motor normativo activo se limita a **tomacorrientes por habitación** (ruleset `cambre-tomas-2026.07.1`). Iluminación, circuitos y cómputo quedan fuera del alcance actual. Detalle técnico: [`docs/normative-rules.md`](normative-rules.md).

## **1\. Introducción y Objetivo**

El presente documento detalla la propuesta para el desarrollo de un Producto Mínimo Viable (MVP) diseñado para optimizar el flujo de trabajo de arquitectos mediante el uso de inteligencia artificial.

**Objetivo Principal:** Desarrollar una plataforma web que permita a los arquitectos cargar archivos CAD (.dwg), procesarlos mediante un modelo de interpretación visual de IA y obtener una propuesta automatizada de ubicación de tomas de luz basada en normativas vigentes, devolviendo el archivo editado.

## **2\. Alcance Funcional (MVP)**

### **Fase 1: Gestión de Accesos**

* **Invitaciones:** El sistema permitirá el envío de invitaciones personalizadas a arquitectos.  
* **Onboarding:** El arquitecto recibirá un correo, completará su perfil profesional y activará su cuenta.  
* **Autenticación:** Sistema de Login/Logout seguro.

### **Fase 2: Gestión de Trabajos**

* **Dashboard:** Visualización de un historial de trabajos realizados, con metadatos (nombre opcional y fecha de creación).  
* **Creación de Proyecto:** Flujo de carga para nuevos análisis.

### **Fase 3: Procesamiento Core (El Motor de IA)**

* **Carga de Archivos:** Soporte para archivos .dwg.  
* **Interpretación:** El sistema enviará el archivo a un modelo intermedio de IA entrenado para lectura de planos.  
* **Inferencia Normativa:** Aplicación de un prompt preconfigurado con las reglas de negocio de Cambre y normativas eléctricas.  
* **Edición de CAD:** La IA generará una capa adicional (*layer*) sobre el archivo original con la disposición técnica de las tomas de luz.

### **Fase 4: Entrega**

* **Descarga:** Botón de exportación del archivo .dwg resultante, manteniendo la integridad del diseño original del arquitecto.

## **3\. Especificaciones Técnicas**

### **Stack Tecnológico Propuesto**

* **Frontend:** React.js con Tailwind CSS (Interfaz moderna, rápida y responsiva).  
* **Backend:** Node.js (Express) para el manejo de archivos pesados.  
* **Procesamiento de IA:** Integración con APIs de visión (GPT-4o/Claude 3.5 Sonnet/a definir segun performance) para la interpretación de layouts y scripts específicos en Python para la manipulación de entidades CAD (librerías como ezdxf).  
* **Base de Datos:** Supabase para la gestión de usuarios y metadatos de proyectos.  
* **Almacenamiento:** Supabase Storage para el resguardo de los planos.

### **Flujo de Datos**

1. **Input:** .dwg (Capa de arquitectura).  
2. **Proceso:** Conversión temporal a formato vectorial/imagen para análisis de IA \-\> Aplicación de Lógica \-\> Generación de coordenadas de tomas.  
3. **Output:** .dwg (Capa de arquitectura \+ Capa "Cambre\_Electrical").

## **4\. Metodología de Trabajo**

Utilizaremos la metodología **Agile (Scrum)**, dividiendo el desarrollo en Sprints de 2 semanas:

1. **Sprint 1 (Fundaciones):** Configuración de entorno, sistema de invitaciones y base de datos.  
2. **Sprint 2 (Gestión de Archivos):** Implementación de subida/descarga y Dashboard.  
3. **Sprint 3 (Integración IA):** Conexión con el modelo de interpretación y lógica de "prompting" normativo.  
4. **Sprint 4 (Refinamiento y QA):** Pruebas de precisión en los planos y ajustes finales de UX.

## **5\. Hoja de Ruta (Funcionalidades a Futuro)**

* **Generación de Cómputo de Materiales:** Listado automático de productos Cambre necesarios para el proyecto.  
* **Editor Online:** Posibilidad de mover las tomas generadas por la IA directamente en el navegador.  
* **Colaboración:** Compartir el proyecto con el cliente final para aprobación visual.