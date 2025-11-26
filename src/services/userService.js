const { User } = require('../models');
const { logger } = require('../utils/logger');

class UserService {
  async findOrCreateUser(userData) {
    try {
      const [user, created] = await User.findOrCreate({
        where: { keycloak_id: userData.id },
        defaults: {
          keycloak_id: userData.id,
          username: userData.username,
          email: userData.email,
          first_name: userData.firstName,
          last_name: userData.lastName,
          full_name: userData.fullName,
          last_login: new Date()
        }
      });

      if (!created) {
        await user.update({
          username: userData.username,
          email: userData.email,
          first_name: userData.firstName,
          last_name: userData.lastName,
          full_name: userData.fullName,
          last_login: new Date()
        });
      }

      logger.info('User synced', { userId: user.id, username: user.username, created });
      return user;
    } catch (error) {
      logger.error('Failed to find/create user', { error: error.message, keycloakId: userData.id });
      throw error;
    }
  }

  async getUserById(id) {
    try {
      const user = await User.findByPk(id);
      return user;
    } catch (error) {
      logger.error('Failed to get user by ID', { error: error.message, userId: id });
      throw error;
    }
  }

  async getUserByKeycloakId(keycloakId) {
    try {
      const user = await User.findOne({
        where: { keycloak_id: keycloakId }
      });
      return user;
    } catch (error) {
      logger.error('Failed to get user by Keycloak ID', { error: error.message, keycloakId });
      throw error;
    }
  }

  async updateUserPreferences(userId, preferences) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const updatedPreferences = {
        ...user.preferences,
        ...preferences
      };

      await user.update({ preferences: updatedPreferences });
      logger.info('User preferences updated', { userId, username: user.username });
      return user;
    } catch (error) {
      logger.error('Failed to update user preferences', { error: error.message, userId });
      throw error;
    }
  }

  async deactivateUser(userId) {
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await user.update({ is_active: false });
      logger.info('User deactivated', { userId, username: user.username });
      return user;
    } catch (error) {
      logger.error('Failed to deactivate user', { error: error.message, userId });
      throw error;
    }
  }

  async getAllUsers(limit = 50, offset = 0) {
    try {
      const { rows: users, count } = await User.findAndCountAll({
        limit,
        offset,
        order: [['created_at', 'DESC']],
        attributes: { exclude: ['preferences'] }
      });

      return {
        users,
        total: count,
        limit,
        offset
      };
    } catch (error) {
      logger.error('Failed to get all users', { error: error.message, limit, offset });
      throw error;
    }
  }
}

module.exports = new UserService();
