import {archiveForms as originalForms} from './archive-schemas.js';
import {receivedForms} from './received-schemas.js';
import {professionalForms} from './professional-schemas.js';
import {cooperationForms} from './cooperation-schemas.js';

// Customer revision, 30.10.2026. Keep source schemas for provenance, but removed
// positions must not be reachable through catalog, generation or saved settings.
export const excludedUaoNumbers = [11, 16];
export const archiveForms = [
 ...originalForms.filter(form => !excludedUaoNumbers.includes(form.uaoNumber)),
 ...receivedForms,
 ...professionalForms,
 ...cooperationForms,
];
export const formDepartment = form => form.departmentId || 'uao';
export const formNumber = form => form.catalogNumber ?? form.uaoNumber;
