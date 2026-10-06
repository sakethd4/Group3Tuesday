ARCHITECTURE
Hospital Equipment Resource Portal

USERS
│
├── Doctors and nurses
│   └── Request, reserve, return
│       └──> React.js + TypeScript
│
└── Inventory managers
    └── Add, repair, retire equipment
        └──> React.js + TypeScript


WEB APPLICATION
React.js + TypeScript
- Login
- Dashboard
- Equipment pages
- Request forms

    ↕
    ├──────────────↔ JWT Authentication
    │                 - Role-based access
    │
    └──────────────↔ Inventory Logic
                      - Availability checks
                      - Reservations
                      - Check-in


BACKEND: Flask (Python)

JWT Authentication
    ↕
    └──────────────↔ Users and Roles [MongoDB]

Inventory Logic
    ↕
    ├──────────────↔ Equipment and Quantities [MongoDB]
    ├──────────────↔ Reservations and Assignments [MongoDB]
    └──────────────↔ Status Changes [MongoDB]


DATABASE
MongoDB
- Users and roles
- Equipment and quantities
- Reservations and assignments
- Status changes


HOSTING
Vercel or AWS (to be decided)



SWE Lab Checkpoint 1
Introduction

Hospitals rely on a limited supply of medical equipment to provide safe and effective patient care. Before admitting a patient, hospital staff must be able to determine whether the equipment required for that patient’s treatment is currently available. This process can be time consuming. Our project is a hospital resource management portal designed to make this process faster and more reliable.

Our project is a Proof of Concept Hardware as a Service (HaaS) web application, inspired by the University of Utah POWDER program.  The system will track different types of medical equipment, the quantity of each resource owned by the hospital, its current location, and whether it is available or already assigned to another patient or room. When a new patient arrives, hospital staff can enter the equipment required for that patient’s care, and the system will determine whether the hospital currently has the necessary resources available.
 If all required equipment is available, the patient can be admitted and those resources can be assigned to the patient. If one or more required resources are unavailable, the system will alert staff that the hospital will not be able to safely accommodate the patient at that time.
By providing a centralized, real-time view of hospital equipment availability, this portal aims to prevent equipment from being overallocated and help hospital staff make faster, more informed decisions about whether the hospital has the resources necessary to care for incoming patients.


 Team Members
Saketh Devarkaonda
Tomi Alaofin
Aalim Momin
Yasir Hassan
Sujan Goruganti
Sprint Cadence
Event-based cadence
Standups via Zoom
1-week sprints
JIRA board
Collaboration tools
Google Drive
Github 
Zoom 
Figma
Messages
Implementation Methodology
We will use one-week sprints to build and review small, working parts of the hospital equipment portal. 
Phase 1: turn the doctors', nurses', and inventory manager's needs into user stories on the Jira board. Each story will have acceptance criteria that describe the expected behavior, API response, and inventory change. 
Model the data and permissions. Define MongoDB records for users and roles, equipment types, quantities, reservations, assignments, and status changes. Agree on which roles can request equipment, change inventory, and return units to service. Document Flask API endpoints and their request and response formats before implementing the corresponding React pages.
Implement the admission workflow. Build a React/TypeScript form where clinical staff enter the types and quantities of equipment a patient needs. The Flask backend will compare every requested quantity with available inventory and return either a complete availability result or a list of shortages. A reservation or checkout will recheck availability when it is saved and update the related records together, avoiding allocating the same unit twice.
Implement inventory and return workflows. Give authorized staff views to search and filter equipment, inspect its status and location, and check assigned equipment back in. Inventory managers will be able to add equipment, mark damaged units unavailable, record maintenance updates, and return repaired units to service. Each change will update the dashboard counts and record who made the change and when.
Integrate and verify each increment. Develop each story on a GitHub feature branch and merge it through a reviewed pull request. Use PyTest for API tests covering availability, insufficient inventory, concurrent checkout, role restrictions, and check-in. Use React Testing Library for forms, status displays, and shortage messages. Review each completed story against its Jira acceptance criteria during the sprint demonstration.
Demonstrate the proof of concept. At the end of Phase 2, deploy the integrated portal to the selected hosting environment and demonstrate a patient equipment request, successful reservation and return, and a request rejected because equipment is unavailable. Record bugs and feedback in Jira and use the sprint retrospective to prioritize fixes.

Toolchain
Frontend:  React.js/TypeScript
Backend: Python with Flask
Database: MongoDB
Security: JWT
Testing: React Testing Library/PyTest
Version Control: GitHub repo
Collaboration: Zoom, Messages, Lab Section, Standups, Github PRs
Deployment: Vercel, AWS, Unknown?

Features: 


Login Portal
Allows authorized hospital staff to securely log into the system using provided credentials.
Role-Based Access
Provides different system privileges based on user role. Clinical staff can request and return equipment, while inventory managers can modify inventory and equipment status.
Dashboard
Displays a high-level overview of equipment availability, equipment currently in use, equipment under maintenance, alerts, and links to major system pages.
Equipment Search
Allows users to quickly search for equipment by name, ID, category, or location.
Equipment Filtering
Allows users to filter equipment based on availability, equipment type, condition, location, or maintenance status.
Equipment Sorting
Allows equipment to be sorted by name, quantity available, status, location, or most recent update.
Equipment Information Page
Displays detailed information for each equipment type or unit, including equipment ID, status, location, condition, availability, and current assignment.
Patient Resource Requirement Form
Allows clinical staff to enter the types and quantities of medical equipment required for an incoming patient.
Patient Admission Resource Check
Compares a patient's equipment requirements against current hospital inventory to determine whether the required resources are available.
Missing Resource Warning
Identifies which required equipment is unavailable when the hospital cannot currently support all of a patient's resource needs.
Equipment Reservation
Allows clinical staff to reserve available equipment for a patient so it cannot be assigned elsewhere.
Patient Equipment Assignment
Associates checked-out medical equipment with a specific patient.
Room Equipment Assignment
Associates medical equipment with a specific hospital room or department for easier tracking.
Check-Out Equipment
Allows clinical staff to request and check out available equipment for patient care.
Check-In Equipment
Allows staff to return equipment when it is no longer needed so that it becomes available again.
Quantity Selection
Allows users to specify how many units of a particular type of equipment are required.
Availability Validation
Prevents users from requesting or checking out more equipment than is currently available.
Automatic Inventory Updates
Automatically updates equipment availability after checkout, check-in, maintenance changes, inventory additions, or equipment removal.
Active Equipment View
Allows users to view equipment currently assigned to patients, rooms, or departments.
Equipment History
Displays previous checkouts, returns, assignments, status changes, users, and timestamps for equipment.
Patient Resource History
Allows hospital staff to view the equipment assigned to a patient during their hospital stay.
Equipment Status Reporting
Allows staff to report equipment as damaged, malfunctioning, missing, or requiring maintenance.
Equipment Status Tracking
Tracks equipment states such as available, reserved, in use, damaged, and under maintenance.
Maintenance Notes
Allows inventory managers to document equipment problems, repairs, inspections, or reasons equipment was removed from service.
Return to Service
Allows an inventory manager to mark repaired or inspected equipment as operational and return it to available inventory.
Add New Equipment
Allows inventory managers to add newly purchased or acquired equipment to hospital inventory.
Update Equipment Inventory
Allows inventory managers to update equipment quantities and other equipment information when inventory changes.
Retire Equipment
Allows outdated, permanently damaged, or removed equipment to be retired from active inventory.
Equipment Location Tracking
Displays the most recently recorded room, department, patient, or storage location associated with equipment.
Equipment Transfer
Allows equipment to be transferred between patients, rooms, or departments while maintaining an updated tracking history.
Reminder System
Generates notifications when equipment has been checked out for an extended period, requires maintenance, or experiences an important status change.
Overdue Equipment Alert
Alerts staff when equipment remains checked out beyond an expected return period.
Low Inventory Alert
Alerts staff when the number of available units for an equipment type falls below a specified threshold.
Maintenance Alert
Notifies inventory managers when equipment is due for maintenance, inspection, or calibration.
Critical Equipment Designation
Allows important resources, such as ventilators or patient monitors, to be designated as critical and highlighted throughout the system.
Patient Priority Level
Allows clinical staff to classify equipment requests by priority, such as routine, urgent, or critical.
Hospital Capacity Indicator
Provides a high-level view of whether critical equipment resources are sufficient to support additional patients.
Equipment Utilization Statistics
Displays information about how frequently different equipment types are used and their overall availability.
Availability Percentage
Shows equipment availability using values such as '8 of 10 available' or '80% available.'
Request Confirmation
Displays confirmation after equipment is successfully reserved, checked out, returned, or transferred.
Cancel Reservation
Allows clinical staff to cancel equipment reservations when a patient no longer requires the resource.
Conflict Prevention
Prevents an individual piece of equipment from being simultaneously assigned to multiple patients or locations.
Audit Log
Records important system actions, including equipment checkout, return, status changes, inventory updates, and the user responsible for each action.
Recent Activity Feed
Displays recently added, checked-out, returned, damaged, repaired, or transferred equipment on the dashboard.



User Stories:
Doctors & Nurses will be focused on admitting patients. They will be in charge of entering the required 
medical equipment the patient needs, and the system will determine if the necessary resources are available. If they are available, the hospital will be able to reserve those resources and admit the patient.

Doctors & Nurses:
As a user, I want to create a secure account given that I am a new doctor or nurse.
As a user, I want to be able to sign in with my credentials.
As a user, I want to have a way to reset my login credentials.
As a user, I want to be able to access the resource inventory.
As a user, I want to be able to find the availability of an individual resource.
As a user, I want to be able to put in a request for new equipment from the inventory manager.
As a user, I want to be able to determine the priority for new equipment upon a request.
As a user, I want to be able to put in a broken equipment work order.

Inventory Manager:
As a user, I want to create a secure account given that I am a new inventory manager.
As a user, I can login securely to the inventory management system with my credentials.
As a user, I want to be able to reset my login credentials
As a user,  I can remove broken or unused equipment from the system. 
As a user, I can add newly purchased equipment to the system.
As a user, I can update equipment quantities
As a user, I can mark equipment as unavailable due to maintenance or failure
As a user, I can return repaired equipment to service. 

Initial work items
Create GitHub repo and add Dr. Samant and the TAs
Define user and equipment properties
Design database API

Research Items
Most common Hospital Equipment used across hospitals in the US
Gripes clinics have with current tracking systems across the US
Equipment needed for most common diseases so we can understand which equipment has highest priority and is most commonly requested
