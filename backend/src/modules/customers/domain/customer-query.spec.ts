import { maskPhone, parseCustomerQuery } from './customer-query';

describe('parseCustomerQuery', () => {
  it('treats empty input as "list all"', () => {
    expect(parseCustomerQuery(undefined)).toEqual({ kind: 'all' });
    expect(parseCustomerQuery('   ')).toEqual({ kind: 'all' });
  });

  it.each(['0911234567', '+251 91 123 4567', '251911234567', '(0911) 234-567'])(
    'normalises the full phone %s',
    (q) => expect(parseCustomerQuery(q)).toEqual({ kind: 'phone', phone: '+251911234567' }),
  );

  it('uses digits for partial phone searches of 4+ digits only', () => {
    expect(parseCustomerQuery('1234')).toEqual({ kind: 'phone-partial', digits: '1234' });
    expect(parseCustomerQuery('09 11 23')).toEqual({ kind: 'phone-partial', digits: '091123' });
    expect(parseCustomerQuery('123')).toEqual({ kind: 'invalid' });
  });

  it('searches names from two characters', () => {
    expect(parseCustomerQuery(' Abebe ')).toEqual({ kind: 'name', text: 'Abebe' });
    expect(parseCustomerQuery('አበበ')).toEqual({ kind: 'name', text: 'አበበ' });
    expect(parseCustomerQuery('a')).toEqual({ kind: 'invalid' });
  });

  it('strips SQL wildcards so they cannot match everything', () => {
    expect(parseCustomerQuery('%')).toEqual({ kind: 'all' });
    expect(parseCustomerQuery('_%_')).toEqual({ kind: 'all' });
    expect(parseCustomerQuery('ab%c')).toEqual({ kind: 'name', text: 'abc' });
  });
});

describe('maskPhone', () => {
  it('keeps the prefix and last three digits', () => {
    expect(maskPhone('+251911234567')).toBe('+2519*****567');
    expect(maskPhone('+251911234567')).toHaveLength('+251911234567'.length);
  });
  it('handles null and short values', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('+2511')).toBe('*****');
  });
});
