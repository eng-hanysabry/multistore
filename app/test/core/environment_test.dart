import 'package:flutter_test/flutter_test.dart';
import 'package:multistore_app/core/config/environment.dart';

void main() {
  test('validate accepts an absolute URL', () {
    expect(
      () => const Environment(apiBaseUrl: 'https://api.example.com').validate(),
      returnsNormally,
    );
  });

  test('validate rejects empty and relative values without printing them', () {
    for (final v in ['', 'not a url', '/relative']) {
      expect(
        () => Environment(apiBaseUrl: v).validate(),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            isNot(contains('relative')),
          ),
        ),
      );
    }
  });

  test('fromDefines yields an empty URL when no dart-define is given', () {
    expect(Environment.fromDefines().apiBaseUrl, isEmpty);
  });
}
