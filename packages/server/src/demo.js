// SPDX-License-Identifier: Apache-2.0
/**
 * An example organisation to try the service with: a made-up company of twenty people. Everything here is
 * invented; any likeness to a real organisation or person is chance.
 */
import { NAME_SEP } from './chart.js';

const P = (name, email) => ({ name, email: `${email}@example.com` });

export const DEMO_PEOPLE = {
  ceo: P('Maya Lindqvist', 'maya'), cfo: P('Daniel Okafor', 'daniel'), cto: P('Sara Ahmadi', 'sara'), coo: P('Lucas Moreau', 'lucas'),
  hr: P('Aiko Tanaka', 'aiko'), lead: P('Omid Rahimi', 'omid'), dev1: P('Elena Petrova', 'elena'), dev2: P('Tom Becker', 'tom'),
  dev3: P('Priya Nair', 'priya'), data: P('Jonas Berg', 'jonas'), ops1: P('Fatima Zahra', 'fatima'), ops2: P('Leo Rossi', 'leo'),
  acc1: P('Hana Kim', 'hana'), acc2: P('Noah Silva', 'noah'), rep1: P('Chloé Martin', 'chloe'), rep2: P('Reza Karimi', 'reza'),
  rep3: P('Ines Duarte', 'ines'), design: P('Kai Müller', 'kai'), people2: P('Zara Hussain', 'zara'), sup: P('Yusuf Demir', 'yusuf'),
};

const D = (...names) => ['Example Co.', ...names].join(NAME_SEP);

/** The rows of the example, in the columns the import reads. */
export function demoRows() {
  const p = DEMO_PEOPLE;
  const row = (department, position, who, more = {}) => ({ department, position, email: who ? who.email : '', name: who ? who.name : '', valid_from: '2024-01-01', ...more });
  return [
    row(D(), 'Chief executive', p.ceo, { is_head: 'yes', code: 'CEO-1' }),
    row(D('Finance'), 'Chief financial officer', p.cfo, { is_head: 'yes', code: 'FIN-1' }),
    row(D('Finance'), 'Accountant', p.acc1, { code: 'FIN-2' }),
    row(D('Finance'), 'Accountant', p.acc2, { code: 'FIN-2' }),
    row(D('Technology'), 'Chief technology officer', p.cto, { is_head: 'yes', code: 'TEC-1' }),
    row(D('Technology', 'Platform'), 'Platform lead', p.lead, { is_head: 'yes', code: 'TEC-10' }),
    row(D('Technology', 'Platform'), 'Software engineer', p.dev1, { code: 'TEC-11' }),
    row(D('Technology', 'Platform'), 'Software engineer', p.dev2, { code: 'TEC-11' }),
    row(D('Technology', 'Platform'), 'Software engineer', p.dev3, { code: 'TEC-11' }),
    row(D('Technology', 'Data'), 'Head of data', null, { is_head: 'yes', code: 'TEC-20' }),
    row(D('Technology', 'Data'), 'Data analyst', p.data, { code: 'TEC-21' }),
    row(D('Technology', 'Design'), 'Product designer', p.design, { code: 'TEC-31' }),
    row(D('Operations'), 'Chief operating officer', p.coo, { is_head: 'yes', code: 'OPS-1' }),
    row(D('Operations', 'Sales'), 'Head of sales', null, { is_head: 'yes', code: 'OPS-10' }),
    row(D('Operations', 'Sales'), 'Account executive', p.rep1, { code: 'OPS-11' }),
    row(D('Operations', 'Sales'), 'Account executive', p.rep2, { code: 'OPS-11' }),
    row(D('Operations', 'Sales'), 'Account executive', p.rep3, { code: 'OPS-11' }),
    row(D('Operations', 'Support'), 'Support lead', p.ops1, { is_head: 'yes', code: 'OPS-20' }),
    row(D('Operations', 'Support'), 'Support specialist', p.ops2, { code: 'OPS-21' }),
    row(D('Operations', 'Support'), 'Support specialist', p.sup, { code: 'OPS-21' }),
    row(D('People'), 'Head of people', p.hr, { is_head: 'yes', code: 'PPL-1' }),
    row(D('People'), 'People partner', p.people2, { code: 'PPL-2' }),
  ];
}
