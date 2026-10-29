import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ipKey } from '../src/index.js';

test('IPv6 addresses count per /64, however they are written', () => {
  assert.equal(ipKey('1.2.3.4'), '1.2.3.4');
  assert.equal(ipKey('2001:db8::5'), '2001:db8:0:0::/64');
  assert.equal(ipKey('2001:db8::5'), ipKey('2001:0db8:0000:0000:0000:0000:0000:0009'));
  assert.equal(ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8:1:2::'), '2001:db8:1:2::/64');
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey('2001:db8:1:2::9', 3), '2001:db8:1::/48');   // signups count per /48
  assert.equal(ipKey('1.2.3.4', 3), '1.2.3.4');
});
