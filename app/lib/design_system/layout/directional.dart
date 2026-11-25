import 'package:material_ui/material_ui.dart';
import 'package:multistore_app/design_system/tokens/spacing.dart';

/// RTL-aware padding helper: directional insets only (spec 4.5 rule 4).
EdgeInsetsDirectional screenPadding() => const EdgeInsetsDirectional.symmetric(
  horizontal: Spacing.md,
  vertical: Spacing.sm,
);
