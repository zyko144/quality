import { test, expect } from '@playwright/test';
import { ameliorerOpus } from '../src/store/devices';
import type { MediaPreferences } from '../src/store/devices';

/**
 * La retouche Opus, sur une SDP a deux pistes sonores.
 *
 * Nomme pour tomber dans un projet existant. Ces cas ne touchent ni au reseau
 * ni a la base : ce sont des chaines de caracteres, et c'est precisement ce
 * qu'on veut eprouver sans monter un appel a deux machines.
 *
 * Le defaut couvert ici s'est produit : la retouche s'arretait a la premiere
 * section audio. Le micro etait servi, le son du partage restait aux reglages
 * par defaut — mono, trente-deux kilobits — et rien ne le signalait.
 */

const MUSIQUE = { audioQuality: 'musique' } as unknown as MediaPreferences;

/** Une SDP reduite a ce qui compte ici : deux sections audio, meme charge utile. */
const SDP_DEUX_PISTES = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:1',
  'a=rtpmap:96 VP8/90000',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:2',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
].join('\r\n');

test.describe('Retouche Opus', () => {
  test('les deux sections audio sont servies', () => {
    const sortie = ameliorerOpus(SDP_DEUX_PISTES, MUSIQUE);
    const fmtp = sortie.split('\r\n').filter((ligne) => ligne.startsWith('a=fmtp:111'));

    expect(fmtp).toHaveLength(2);

    for (const ligne of fmtp) {
      expect(ligne).toContain('stereo=1');
      expect(ligne).toContain('maxaveragebitrate=128000');
      // Ce que le moteur avait negocie n'est pas jete au passage.
      expect(ligne).toContain('minptime=10');
      // `useinbandfec` etait deja la : il ne doit pas s'y trouver deux fois.
      expect(ligne.match(/useinbandfec=/g)).toHaveLength(1);
    }
  });

  test('la video n est pas touchee', () => {
    const sortie = ameliorerOpus(SDP_DEUX_PISTES, MUSIQUE);
    expect(sortie).toContain('a=rtpmap:96 VP8/90000');
    expect(sortie.split('m=video').length).toBe(2);
  });

  test('une section audio sans fmtp en recoit une', () => {
    const sans = SDP_DEUX_PISTES.replace(/^a=fmtp:111 .*$/gm, '').replace(/\r\n\r\n/g, '\r\n');
    const sortie = ameliorerOpus(sans, MUSIQUE);
    expect(sortie.split('\r\n').filter((l) => l.startsWith('a=fmtp:111'))).toHaveLength(2);
  });

  test('une SDP sans audio ressort intacte', () => {
    const video = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000'].join('\r\n');
    expect(ameliorerOpus(video, MUSIQUE)).toBe(video);
  });
});
