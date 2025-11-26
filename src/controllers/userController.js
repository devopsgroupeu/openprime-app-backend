const userService = require('../services/userService');

class UserController {
  async getCurrentUser(req, res) {
    try {
      let user = await userService.getUserByKeycloakId(req.user.id);

      if (!user) {
        user = await userService.findOrCreateUser(req.user);
      }

      res.json({
        id: user.id,
        keycloak_id: user.keycloak_id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: user.full_name,
        preferences: user.preferences,
        lastLogin: user.last_login,
        isActive: user.is_active,
        roles: req.user.roles
      });
    } catch (error) {
      req.log.error('Failed to get current user', { error: error.message });
      res.status(500).json({ error: 'Failed to get user information' });
    }
  }

  async updateProfile(req, res) {
    try {
      const { firstName, lastName, email } = req.body;

      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updatedUser = await user.update({
        first_name: firstName,
        last_name: lastName,
        email: email,
        full_name: `${firstName} ${lastName}`.trim()
      });

      req.log.info('Profile updated', { userId: user.id });
      res.json({
        message: 'Profile updated successfully',
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          firstName: updatedUser.first_name,
          lastName: updatedUser.last_name,
          fullName: updatedUser.full_name
        }
      });
    } catch (error) {
      req.log.error('Failed to update profile', { error: error.message });
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }

  async updatePreferences(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updatedUser = await userService.updateUserPreferences(user.id, req.body);

      req.log.info('Preferences updated', { userId: user.id });
      res.json({
        message: 'Preferences updated successfully',
        preferences: updatedUser.preferences
      });
    } catch (error) {
      req.log.error('Failed to update preferences', { error: error.message });
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  }

  async getPreferences(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        preferences: user.preferences
      });
    } catch (error) {
      req.log.error('Failed to get preferences', { error: error.message });
      res.status(500).json({ error: 'Failed to get preferences' });
    }
  }

  async getAllUsers(req, res) {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const result = await userService.getAllUsers(parseInt(limit), parseInt(offset));

      res.json(result);
    } catch (error) {
      req.log.error('Failed to get all users', { error: error.message });
      res.status(500).json({ error: 'Failed to get users' });
    }
  }

  async deactivateUser(req, res) {
    try {
      const { userId } = req.params;

      if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot deactivate your own account' });
      }

      const user = await userService.deactivateUser(userId);
      req.log.info('User deactivated', { targetUserId: userId });
      res.json({
        message: 'User deactivated successfully',
        user: {
          id: user.id,
          username: user.username,
          isActive: user.is_active
        }
      });
    } catch (error) {
      req.log.error('Failed to deactivate user', { targetUserId: req.params.userId, error: error.message });
      res.status(500).json({ error: 'Failed to deactivate user' });
    }
  }
}

module.exports = new UserController();
