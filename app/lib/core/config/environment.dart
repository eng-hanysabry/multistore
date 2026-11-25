/// Build-time configuration. The API base URL is passed with
/// `--dart-define=API_BASE_URL=...` (spec 3, rule 6). Nothing else is shared with the API project.
class Environment {
  const Environment({required this.apiBaseUrl});

  /// Reads `API_BASE_URL` from `--dart-define`.
  factory Environment.fromDefines() =>
      const Environment(apiBaseUrl: String.fromEnvironment('API_BASE_URL'));

  final String apiBaseUrl;

  /// Throws [StateError] naming the problem, never a value.
  void validate() {
    final uri = Uri.tryParse(apiBaseUrl);
    if (apiBaseUrl.isEmpty ||
        uri == null ||
        !uri.hasScheme ||
        uri.host.isEmpty) {
      throw StateError(
        'API_BASE_URL must be set with --dart-define to an absolute URL',
      );
    }
  }
}
// ci smoke
